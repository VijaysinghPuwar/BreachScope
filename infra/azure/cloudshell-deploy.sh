#!/usr/bin/env bash
# Deploys the sensor from Azure Cloud Shell (https://shell.azure.com, Bash),
# which already has az and terraform and is signed in. Useful when an
# organisation's sign-in policy blocks the Azure CLI on personal machines.
#
#   ADMIN_IP=203.0.113.10 BUDGET_EMAIL=you@example.com \
#   SSH_PUBKEY="ssh-ed25519 AAAA... you" bash cloudshell-deploy.sh
#
# Prints the two public values the website needs (sensor URL and public key).
set -euo pipefail
: "${ADMIN_IP:?set ADMIN_IP to your public IP}"
: "${BUDGET_EMAIL:?set BUDGET_EMAIL}"
: "${SSH_PUBKEY:?set SSH_PUBKEY to your SSH public key}"

cd "$(dirname "$0")"
cat > terraform.tfvars <<VARS
subscription_id = "$(az account show --query id -o tsv)"
admin_cidr      = "${ADMIN_IP}/32"
budget_email    = "${BUDGET_EMAIL}"
ssh_public_key  = "${SSH_PUBKEY}"
VARS

terraform init -input=false
terraform apply -input=false -auto-approve

echo
echo "SENSOR_URL:  $(terraform output -raw sensor_url)"
echo "ADMIN SSH:   $(terraform output -raw admin_ssh)"
echo "PUBLIC KEY (safe to share):"
terraform output -raw sensor_public_key
