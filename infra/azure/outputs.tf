output "public_ip" {
  value = azurerm_public_ip.sensor.ip_address
}

output "sensor_public_key" {
  description = "Committed to pkg/feeds/sensor_pubkey.pem so the website can verify exports."
  value       = tls_private_key.sensor.public_key_pem
}

output "sensor_url" {
  description = "Committed to pkg/feeds/sensor.go (not a secret)."
  value       = "http://${azurerm_public_ip.sensor.ip_address}:8443/events"
}

output "admin_ssh" {
  value = "ssh -p 22222 sensoradmin@${azurerm_public_ip.sensor.ip_address}"
}
