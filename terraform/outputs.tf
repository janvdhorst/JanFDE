output "service_url" {
  description = "Public HTTPS URL of the App Runner service"
  value       = "https://${aws_apprunner_service.app.service_url}"
}

output "ecr_repository_url" {
  description = "ECR repository URI for tagging and pushing images"
  value       = aws_ecr_repository.app.repository_url
}

output "apprunner_service_arn" {
  description = "ARN of the App Runner Service"
  value       = aws_apprunner_service.app.arn
}
