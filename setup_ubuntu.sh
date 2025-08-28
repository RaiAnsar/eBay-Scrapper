#!/bin/bash

# eBay Scraper Setup Script for Ubuntu 24.04 LTS
# This script sets up a lightweight scraping environment

echo "==========================================="
echo "eBay Scraper Setup for Ubuntu 24.04 LTS"
echo "==========================================="
echo ""

# Update system
echo "1. Updating system packages..."
sudo apt-get update -y

# Install Python and pip
echo "2. Installing Python and dependencies..."
sudo apt-get install -y python3 python3-pip python3-venv

# Install browsers and drivers
echo "3. Installing browsers and drivers..."
sudo apt-get install -y \
    chromium-browser \
    chromium-chromedriver \
    firefox \
    firefox-geckodriver

# Install Node.js (for Puppeteer option)
echo "4. Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create virtual environment for Python
echo "5. Setting up Python virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install Python packages
echo "6. Installing Python packages..."
pip install --upgrade pip
pip install \
    selenium \
    beautifulsoup4 \
    pandas \
    psutil \
    openpyxl \
    requests

# Install Node packages
echo "7. Installing Node.js packages..."
npm install

# Install Docker (optional, for Selenium Grid)
read -p "Do you want to install Docker for distributed scraping? (y/n): " install_docker
if [ "$install_docker" = "y" ]; then
    echo "8. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    
    # Install Docker Compose
    sudo apt-get install -y docker-compose
    
    echo "Docker installed. You'll need to logout and login for group changes to take effect."
fi

# Create results directory
mkdir -p results

# Make scripts executable
chmod +x ubuntu_scraper.py
chmod +x lightweight_scraper.js

echo ""
echo "==========================================="
echo "Setup Complete!"
echo "==========================================="
echo ""
echo "Available scrapers:"
echo "  1. Python/Selenium (lightweight):"
echo "     python3 ubuntu_scraper.py 'blu ray' --pages 10"
echo ""
echo "  2. Node.js/Puppeteer (single browser):"
echo "     npm start"
echo ""
echo "  3. Google Colab (cloud-based):"
echo "     Upload ebay_scraper_colab.ipynb to Google Colab"
echo ""
if [ "$install_docker" = "y" ]; then
    echo "  4. Docker Selenium Grid (distributed):"
    echo "     docker-compose -f docker-compose-selenium.yml up"
fi
echo ""
echo "All scrapers are resource-optimized and won't burn your hardware!"