#!/bin/bash
# This script deploys the latest commit by pushing it to GitHub.

echo "Starting deployment..."

git push

if [ $? -eq 0 ]; then
  echo "Deployment successfully triggered!"
  echo "You can monitor the progress in the \"Actions\" tab of your GitHub repository."
else
  echo "Deployment failed. Please check the error messages above."
fi
