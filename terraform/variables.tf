variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Application name used for resource naming"
  type        = string
  default     = "happyrobot-api"
}

variable "image_tag" {
  description = "Docker image tag to deploy (git short SHA by default)"
  type        = string
}

variable "container_port" {
  description = "Port the container listens on"
  type        = number
  default     = 3000
}

variable "cpu" {
  description = "CPU units for the App Runner instance (256, 512, 1024, 2048, 4096)"
  type        = string
  default     = "1024"
}

variable "memory" {
  description = "Memory in MB for the App Runner instance (512, 1024, 2048, 3072, 4096, ...)"
  type        = string
  default     = "2048"
}

variable "api_key_secret" {
  description = "Secret key used for API endpoint authentication"
  type        = string
  sensitive   = true
  default     = "kpsyn89kYorRJOR2ePOmu5a8O1H5cgUnxSXXxAfgzvc="
}

variable "fmcsa_api_key" {
  description = "FMCSA API key for carrier verification"
  type        = string
  sensitive   = true
  default     = "cdc33e44d693a3a58451898d4ec9df862c65b954"
}

