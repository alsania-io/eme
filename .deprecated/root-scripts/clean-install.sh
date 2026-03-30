#!/bin/bash
cd /home/sigma/Desktop/echo-lab/eme

# Try multiple methods to remove node_modules
if [ -d "node_modules" ]; then
  # Use find to delete files first, then directories
  find node_modules -type f -exec rm -f {} \;
  find node_modules -type d -empty -delete
  rm -rf node_modules 2>/dev/null
fi

# Remove package-lock if exists
rm -f package-lock.json

# Clear npm cache
npm cache clean --force

# Fresh install
echo "Installing packages..."
npm install

echo "Done."