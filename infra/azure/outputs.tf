output "public_ip" {
  value = azurerm_public_ip.sensor.ip_address
}

output "sensor_url" {
  description = "Set as SENSOR_URL in Vercel."
  value       = "http://${azurerm_public_ip.sensor.ip_address}:8443/events"
}

output "admin_ssh" {
  value = "ssh -p 22222 sensoradmin@${azurerm_public_ip.sensor.ip_address}"
}
