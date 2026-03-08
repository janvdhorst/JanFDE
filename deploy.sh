#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# deploy.sh — Build, push to ECR, and deploy via Terraform
#
# Prerequisites:
#   - AWS CLI v2 configured with valid credentials
#   - Docker running
#   - Terraform >= 1.5
#   - A Dockerfile in the project root
#
# Usage:
#   ./deploy.sh                  # full deploy (build + push + terraform apply)
#   ./deploy.sh --plan           # build + push + terraform plan (no apply)
#   ./deploy.sh --destroy        # tear everything down
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/terraform"

AWS_REGION="${AWS_REGION:-us-east-1}"
APP_NAME="${APP_NAME:-happyrobot-api}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "${SCRIPT_DIR}" rev-parse --short HEAD)}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}"
APP_RUNNER_SERVICE_ARN=""

tf_output_raw() {
  terraform -chdir="${TF_DIR}" output -raw "$1" 2>/dev/null || true
}

load_existing_deploy_context() {
  local state_ecr_uri state_service_arn state_account_id state_region

  state_ecr_uri="$(tf_output_raw ecr_repository_url)"
  state_service_arn="$(tf_output_raw apprunner_service_arn)"

  if [[ -n "${state_ecr_uri}" ]]; then
    ECR_URI="${state_ecr_uri}"
    state_account_id="${state_ecr_uri%%.*}"
  fi

  if [[ -n "${state_service_arn}" ]]; then
    APP_RUNNER_SERVICE_ARN="${state_service_arn}"
    state_region="$(cut -d: -f4 <<< "${state_service_arn}")"
    state_account_id="${state_account_id:-$(cut -d: -f5 <<< "${state_service_arn}")}"
  fi

  if [[ -n "${state_account_id:-}" && "${state_account_id}" != "${AWS_ACCOUNT_ID}" ]]; then
    echo "ERROR: Active AWS account ${AWS_ACCOUNT_ID} does not match Terraform state account ${state_account_id}." >&2
    echo "       Switch to the correct AWS profile/account before deploying." >&2
    exit 1
  fi

  if [[ -n "${state_region:-}" && "${state_region}" != "${AWS_REGION}" ]]; then
    echo "ERROR: AWS_REGION=${AWS_REGION} does not match Terraform state region ${state_region}." >&2
    echo "       Re-run with the correct AWS_REGION before deploying." >&2
    exit 1
  fi
}

wait_for_apprunner_idle() {
  local service_arn status attempt

  if [[ -n "${APP_RUNNER_SERVICE_ARN}" ]]; then
    service_arn="${APP_RUNNER_SERVICE_ARN}"
  else
    service_arn="$(
      aws apprunner list-services --region "${AWS_REGION}" \
        --query "ServiceSummaryList[?ServiceName=='${APP_NAME}'].ServiceArn | [0]" \
        --output text
    )"
  fi

  if [[ -z "${service_arn}" || "${service_arn}" == "None" ]]; then
    echo "==> No existing App Runner service found for ${APP_NAME}; continuing."
    return 0
  fi

  echo "==> Waiting for App Runner service to become idle..."
  for attempt in {1..120}; do
    status="$(
      aws apprunner describe-service --region "${AWS_REGION}" --service-arn "${service_arn}" \
        --query "Service.Status" --output text
    )"

    echo "    App Runner status: ${status}"
    if [[ "${status}" != *"IN_PROGRESS"* ]]; then
      echo "==> App Runner is idle."
      return 0
    fi
    sleep 5
  done

  echo "ERROR: Timed out waiting for App Runner service ${APP_NAME} to become idle." >&2
  return 1
}

# ---- Handle --destroy early ------------------------------------------------
if [[ "${1:-}" == "--destroy" ]]; then
  echo "==> Destroying all resources..."
  terraform -chdir="${TF_DIR}" init -input=false
  load_existing_deploy_context
  echo "==> AWS Account: ${AWS_ACCOUNT_ID}"
  echo "==> Region:      ${AWS_REGION}"
  echo "==> ECR URI:     ${ECR_URI}"
  echo ""
  wait_for_apprunner_idle
  terraform -chdir="${TF_DIR}" destroy -auto-approve \
    -var="image_tag=${IMAGE_TAG}"
  exit 0
fi

# ---- 1. Terraform init (creates ECR repo if it doesn't exist yet) ----------
echo "==> Running terraform init..."
terraform -chdir="${TF_DIR}" init -input=false
load_existing_deploy_context

echo "==> AWS Account: ${AWS_ACCOUNT_ID}"
echo "==> Region:      ${AWS_REGION}"
echo "==> ECR URI:     ${ECR_URI}"
echo ""

# Check if ECR repo already exists; if not, apply just the ECR resource first
if ! aws ecr describe-repositories --repository-names "${APP_NAME}" --region "${AWS_REGION}" &>/dev/null; then
  echo "==> ECR repository does not exist yet — creating it..."
  terraform -chdir="${TF_DIR}" apply -auto-approve \
    -target=aws_ecr_repository.app \
    -var="image_tag=${IMAGE_TAG}"
  load_existing_deploy_context
fi

# ---- 2. Authenticate Docker to ECR ----------------------------------------
echo "==> Logging in to ECR..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin \
    "$(cut -d/ -f1 <<< "${ECR_URI}")"

# ---- 3. Build & push Docker image -----------------------------------------
echo "==> Building Docker image (linux/amd64)..."
docker build --platform linux/amd64 -t "${APP_NAME}:${IMAGE_TAG}" "${SCRIPT_DIR}"

echo "==> Tagging image for ECR..."
docker tag "${APP_NAME}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"

echo "==> Pushing image to ECR..."
docker push "${ECR_URI}:${IMAGE_TAG}"

# ---- 4. Terraform plan / apply --------------------------------------------
if [[ "${1:-}" == "--plan" ]]; then
  echo "==> Running terraform plan..."
  wait_for_apprunner_idle
  terraform -chdir="${TF_DIR}" plan \
    -var="image_tag=${IMAGE_TAG}"
else
  echo "==> Running terraform apply..."
  wait_for_apprunner_idle
  terraform -chdir="${TF_DIR}" apply -auto-approve \
    -var="image_tag=${IMAGE_TAG}"

  APP_RUNNER_SERVICE_ARN="$(tf_output_raw apprunner_service_arn)"
  if [[ -n "${APP_RUNNER_SERVICE_ARN}" ]]; then
    echo "==> Forcing App Runner to pull latest image..."
    aws apprunner start-deployment --region "${AWS_REGION}" \
      --service-arn "${APP_RUNNER_SERVICE_ARN}" --output json
  fi

  echo ""
  echo "==> Deployment triggered. App Runner is now deploying image tag: ${IMAGE_TAG}"
  echo "    Service URL: $(terraform -chdir="${TF_DIR}" output -raw service_url)"
  echo "    ECR Repo:    $(terraform -chdir="${TF_DIR}" output -raw ecr_repository_url)"
fi
