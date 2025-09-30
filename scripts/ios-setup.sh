#!/bin/bash

# VibeCodes iOS Setup Script
echo "🚀 Setting up VibeCodes iOS app..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Build the web app
echo "📦 Building web app..."
npm run build

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "❌ Error: Web app build failed"
    exit 1
fi

# Install iOS dependencies
echo "📱 Installing iOS dependencies..."
cd ios
pod install

# Check if pod install was successful
if [ $? -ne 0 ]; then
    echo "❌ Error: CocoaPods installation failed"
    echo "💡 Make sure you have CocoaPods installed: gem install cocoapods"
    exit 1
fi

cd ..

echo "✅ iOS setup complete!"
echo ""
echo "Next steps:"
echo "1. Run 'npm run ios:open' to open in Xcode"
echo "2. Or run 'npm run ios:run' to run on simulator"
echo "3. For device testing, open Xcode and build for your device"
echo ""
echo "📖 See ios/README.md for detailed instructions"
