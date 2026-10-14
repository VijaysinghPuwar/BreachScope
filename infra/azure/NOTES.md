# Honeypot sensor (Azure)

One small VM runs [Cowrie](https://github.com/cowrie/cowrie), a fake SSH and Telnet server that records what attackers try. It is the only source that sees attacks itself, so it is the only source whose map arcs end at a real target: `sensor-eus1`.

## How it fits together

```
attacker ──22/23──▶ VM ──iptables──▶ Cowrie (2222/2223) ──▶ cowrie.json
                                                                 │
website /api/live ◀──HMAC-signed JSON── exporter.py (8443) ◀─────┘
```

- **Ports.** 22 and 23 are redirected to Cowrie. The real SSH daemon listens on 22222 and the NSG only lets `admin_cidr` reach it.
- **Containment.** The NSG allows outbound web and DNS only. On the host, an iptables owner rule stops the `cowrie` user from opening any outbound connection, so commands an attacker types (`wget`, `curl`) cannot fetch anything. Replies to the attacker still flow.
- **Export.** `exporter.py` groups the last 48 hours by attacker IP, protocol and hour and serves it on `GET /events`. Each response is signed: `X-Signature = HMAC-SHA256(secret, X-Timestamp + "." + body)`. The website refuses unsigned, altered or stale (over 10 minutes) responses. Passwords attackers try are never exported, only usernames. Cached for 30 s and limited to 30 requests a minute per address.
- **Position.** The sensor is drawn at the published centre of the Azure East US region and labelled `configured`, never at a geolocated address.

## Cost

`Standard_B1s` with a 30 GB standard disk and one static IP. On Azure for Students this runs on the free credit. A resource-group budget emails at 25% and 50% of `budget_amount`. If the credit runs out, Azure stops the VM, the sensor disappears from the map and every other source keeps working.

## Deploy

```sh
az login
cd infra/azure
cp terraform.tfvars.example terraform.tfvars   # fill in; never commit it
terraform init && terraform apply
terraform output sensor_url                    # set SENSOR_URL in Vercel
```

Then set `SENSOR_URL` and `SENSOR_HMAC_SECRET` (the same secret as in `terraform.tfvars`) in the Vercel project and redeploy.

## Operate

- Admin shell: `terraform output admin_ssh`.
- Logs: `journalctl -u cowrie -u sensor-exporter`.
- Rebuild from scratch: `terraform apply -replace=azurerm_linux_virtual_machine.sensor`.
- Remove everything: `terraform destroy`.
