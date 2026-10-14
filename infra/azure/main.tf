# A single small VM running the Cowrie SSH and Telnet honeypot. Attackers
# reach Cowrie on ports 22 and 23; the real SSH daemon listens on 22222 and is
# reachable only from admin_cidr. A tiny read-only exporter on 8443 serves the
# last 48 hours of Cowrie sessions, signed with HMAC, for the website to pull.

locals {
  name = "breachscope-sensor"
  tags = { project = "breachscope", role = "honeypot" }
}

resource "azurerm_resource_group" "sensor" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_virtual_network" "sensor" {
  name                = "vnet-${local.name}"
  address_space       = ["10.40.0.0/24"]
  location            = azurerm_resource_group.sensor.location
  resource_group_name = azurerm_resource_group.sensor.name
  tags                = local.tags
}

resource "azurerm_subnet" "sensor" {
  name                 = "snet-${local.name}"
  resource_group_name  = azurerm_resource_group.sensor.name
  virtual_network_name = azurerm_virtual_network.sensor.name
  address_prefixes     = ["10.40.0.0/27"]
}

resource "azurerm_network_security_group" "sensor" {
  name                = "nsg-${local.name}"
  location            = azurerm_resource_group.sensor.location
  resource_group_name = azurerm_resource_group.sensor.name
  tags                = local.tags

  security_rule {
    name                       = "honeypot-ssh-telnet"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["22", "23"]
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "admin-ssh"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22222"
    source_address_prefix      = var.admin_cidr
    destination_address_prefix = "*"
  }

  # Read-only, HMAC-signed, rate limited. Vercel has no fixed egress IPs on
  # the Hobby plan, so this cannot be narrowed to a source range.
  security_rule {
    name                       = "exporter"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8443"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  # Outbound: only web traffic for package updates and DNS. The Cowrie user
  # is additionally blocked from all outbound connections on the host.
  security_rule {
    name                       = "out-web"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["80", "443"]
    source_address_prefix      = "*"
    destination_address_prefix = "Internet"
  }

  security_rule {
    name                       = "out-dns"
    priority                   = 110
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "53"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "out-deny-internet"
    priority                   = 4000
    direction                  = "Outbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "Internet"
  }
}

resource "azurerm_public_ip" "sensor" {
  name                = "pip-${local.name}"
  location            = azurerm_resource_group.sensor.location
  resource_group_name = azurerm_resource_group.sensor.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

resource "azurerm_network_interface" "sensor" {
  name                = "nic-${local.name}"
  location            = azurerm_resource_group.sensor.location
  resource_group_name = azurerm_resource_group.sensor.name
  tags                = local.tags

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.sensor.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.sensor.id
  }
}

resource "azurerm_network_interface_security_group_association" "sensor" {
  network_interface_id      = azurerm_network_interface.sensor.id
  network_security_group_id = azurerm_network_security_group.sensor.id
}

resource "azurerm_linux_virtual_machine" "sensor" {
  name                            = "vm-${local.name}"
  location                        = azurerm_resource_group.sensor.location
  resource_group_name             = azurerm_resource_group.sensor.name
  size                            = "Standard_B1s"
  admin_username                  = "sensoradmin"
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.sensor.id]
  tags                            = local.tags

  admin_ssh_key {
    username   = "sensoradmin"
    public_key = file(pathexpand(var.ssh_public_key_path))
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
    disk_size_gb         = 30
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hmac_secret = var.exporter_hmac_secret
    exporter    = file("${path.module}/exporter.py")
  }))
}

resource "azurerm_consumption_budget_resource_group" "sensor" {
  name              = "budget-${local.name}"
  resource_group_id = azurerm_resource_group.sensor.id
  amount            = var.budget_amount
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  notification {
    enabled        = true
    threshold      = 25
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.budget_email]
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.budget_email]
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}
