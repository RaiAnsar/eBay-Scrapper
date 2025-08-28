#!/bin/bash

# eBay Scraper Server Deployment Script for ebay.mediatronixs.com
# Run this on your local machine to deploy to server

SERVER="46.202.195.247"
SSH_KEY="~/.ssh/vps"
DOMAIN="ebay.mediatronixs.com"

echo "🚀 Deploying eBay Scraper to $DOMAIN"

# Create deployment package
echo "📦 Creating deployment package..."
tar -czf ebay-scraper-deploy.tar.gz \
  server_advanced.js \
  web_interface_advanced.html \
  node_scraper.js \
  package.json \
  ecosystem.config.js

# Upload to server
echo "📤 Uploading to server..."
scp -i $SSH_KEY ebay-scraper-deploy.tar.gz root@$SERVER:/tmp/

# Execute deployment on server
echo "🔧 Setting up on server..."
ssh -i $SSH_KEY root@$SERVER << 'ENDSSH'
# Create directory for eBay scraper
echo "Creating directory structure..."
mkdir -p /var/www/ebay-scraper
cd /var/www/ebay-scraper

# Extract files
tar -xzf /tmp/ebay-scraper-deploy.tar.gz
rm /tmp/ebay-scraper-deploy.tar.gz

# Create necessary directories
mkdir -p results logs

# Set permissions
chown -R www-data:www-data /var/www/ebay-scraper
chmod -R 755 /var/www/ebay-scraper
chmod -R 777 results logs

# Install Node dependencies
echo "Installing Node.js dependencies..."
npm install

# Install PM2 if not installed
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

# Stop any existing instance
pm2 stop ebay-scraper 2>/dev/null
pm2 delete ebay-scraper 2>/dev/null

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

# Create Nginx configuration
echo "Configuring Nginx..."
cat > /etc/nginx/sites-available/ebay-scraper << 'NGINX'
server {
    listen 80;
    server_name ebay.mediatronixs.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support
        proxy_read_timeout 86400;
    }
    
    # Allow larger uploads
    client_max_body_size 100M;
}
NGINX

# Enable site
ln -sf /etc/nginx/sites-available/ebay-scraper /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Install SSL certificate with Certbot
echo "Installing SSL certificate..."
certbot --nginx -d ebay.mediatronixs.com --non-interactive --agree-tos --email admin@mediatronixs.com --redirect

echo "✅ Deployment complete!"
echo "🌐 eBay Scraper is now available at: https://ebay.mediatronixs.com"
echo ""
echo "📊 Useful commands:"
echo "  View logs: pm2 logs ebay-scraper"
echo "  Monitor: pm2 monit"
echo "  Restart: pm2 restart ebay-scraper"
echo "  Stop: pm2 stop ebay-scraper"
ENDSSH

# Clean up local package
rm -f ebay-scraper-deploy.tar.gz

echo "✅ Deployment script complete!"
echo "🌐 Visit https://ebay.mediatronixs.com to access your scraper"
