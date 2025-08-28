#!/bin/bash

# eBay Scraper Deployment Script
# Usage: ./deploy.sh

echo "🚀 Deploying eBay Scraper to Server..."

# Install Node.js dependencies
echo "📦 Installing dependencies..."
npm install

# Create necessary directories
mkdir -p results
mkdir -p logs

# Install PM2 globally if not installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Stop existing instance if running
pm2 stop ebay-scraper 2>/dev/null

# Start the application with PM2
echo "🔧 Starting application with PM2..."
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup

echo "✅ Deployment complete!"
echo "📊 View logs: pm2 logs ebay-scraper"
echo "📊 Monitor: pm2 monit"
echo "🔄 Restart: pm2 restart ebay-scraper"
echo "🛑 Stop: pm2 stop ebay-scraper"
echo ""
echo "🌐 Access the scraper at: http://YOUR_SERVER_IP:3000"
