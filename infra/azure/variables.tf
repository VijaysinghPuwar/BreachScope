variable "subscription_id" {
  description = "Azure subscription to deploy into (az account show --query id -o tsv)."
  type        = string
}

variable "location" {
  description = "Azure region. The sensor's map position is this region's published centre."
  type        = string
  default     = "eastus"
}

variable "admin_cidr" {
  description = "Your public IP as a /32. Only this address can reach the real SSH port."
  type        = string
}

variable "ssh_public_key" {
  description = "Public key for the admin account, as text (for Cloud Shell). Leave empty to read ssh_public_key_path."
  type        = string
  default     = ""
}

variable "ssh_public_key_path" {
  description = "Public key file for the admin account, used when ssh_public_key is empty."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "budget_email" {
  description = "Where budget alerts go."
  type        = string
}

variable "budget_amount" {
  description = "Monthly budget in USD. Alerts fire at 25% and 50% of it."
  type        = number
  default     = 100
}
