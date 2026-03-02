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
IMAGE_TAG="${IMAGE_TAG:-latest}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}"

echo "==> AWS Account: ${AWS_ACCOUNT_ID}"
echo "==> Region:      ${AWS_REGION}"
echo "==> ECR URI:     ${ECR_URI}"
echo ""

# ---- Handle --destroy early ------------------------------------------------
if [[ "${1:-}" == "--destroy" ]]; then
  echo "==> Destroying all resources..."
  terraform -chdir="${TF_DIR}" init -input=false
  terraform -chdir="${TF_DIR}" destroy -auto-approve \
    -var="image_tag=${IMAGE_TAG}"
  exit 0
fi

# ---- 1. Terraform init (creates ECR repo if it doesn't exist yet) ----------
echo "==> Running terraform init..."
terraform -chdir="${TF_DIR}" init -input=false

# Check if ECR repo already exists; if not, apply just the ECR resource first
if ! aws ecr describe-repositories --repository-names "${APP_NAME}" --region "${AWS_REGION}" &>/dev/null; then
  echo "==> ECR repository does not exist yet — creating it..."
  terraform -chdir="${TF_DIR}" apply -auto-approve \
    -target=aws_ecr_repository.app \
    -var="image_tag=${IMAGE_TAG}"
fi

# ---- 2. Authenticate Docker to ECR ----------------------------------------
echo "==> Logging in to ECR..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# ---- 3. Build & push Docker image -----------------------------------------
echo "==> Building Docker image..."
docker build -t "${APP_NAME}:${IMAGE_TAG}" "${SCRIPT_DIR}"

echo "==> Tagging image for ECR..."
docker tag "${APP_NAME}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"

echo "==> Pushing image to ECR..."
docker push "${ECR_URI}:${IMAGE_TAG}"

# ---- 4. Terraform plan / apply --------------------------------------------
if [[ "${1:-}" == "--plan" ]]; then
  echo "==> Running terraform plan..."
  terraform -chdir="${TF_DIR}" plan \
    -var="image_tag=${IMAGE_TAG}"
else
  echo "==> Running terraform apply..."
  terraform -chdir="${TF_DIR}" apply -auto-approve \
    -var="image_tag=${IMAGE_TAG}"

  echo ""
  echo "==> Deployment complete!"
  echo "    Service URL: $(terraform -chdir="${TF_DIR}" output -raw service_url)"
  echo "    ECR Repo:    $(terraform -chdir="${TF_DIR}" output -raw ecr_repository_url)"
fi
