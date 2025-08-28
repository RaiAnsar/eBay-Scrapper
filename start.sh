#!/bin/bash

echo "🚀 eBay Scraper - Choose Your Option"
echo "===================================="
echo ""
echo "1) Web Interface (Recommended)"
echo "2) Command Line Scraper"
echo "3) Test with your URL"
echo ""
read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        echo "Starting web interface..."
        node server.js
        ;;
    2)
        echo "Starting command line scraper..."
        echo "Enter search term (e.g., 'blu ray'):"
        read search
        echo "Enter max pages (e.g., 10):"
        read pages
        node node_scraper.js "$search" "$pages" false
        ;;
    3)
        echo "Test scraping with specific URL..."
        URL="https://www.ebay.co.uk/sch/i.html?_nkw=blu+ray&_sacat=0&_from=R40&LH_PrefLoc=1&LH_ItemCondition=1000&LH_BIN=1&LH_FS=1&Format=DVD%7C4K%2520UHD%2520Blu%252Dray%7CBlu%252Dray%7CBlu%252Dray%25203D&rt=nc&Genre=Horror&_dcat=617"
        node node_scraper.js "$URL" 5 false
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac