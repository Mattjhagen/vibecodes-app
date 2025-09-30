#!/bin/bash

# TestFlight Preparation Script
echo "🚀 Preparing VibeCodes for TestFlight deployment..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Check if Xcode is installed
if ! command -v xcodebuild &> /dev/null; then
    echo "❌ Error: Xcode is not installed or not in PATH"
    echo "💡 Please install Xcode from the Mac App Store"
    exit 1
fi

# Check if CocoaPods is installed
if ! command -v pod &> /dev/null; then
    echo "❌ Error: CocoaPods is not installed"
    echo "💡 Install with: gem install cocoapods"
    exit 1
fi

echo "✅ Prerequisites check passed"

# Build the web app
echo "📦 Building web application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Error: Web app build failed"
    exit 1
fi

echo "✅ Web app built successfully"

# Install iOS dependencies
echo "📱 Installing iOS dependencies..."
cd ios
pod install

if [ $? -ne 0 ]; then
    echo "❌ Error: CocoaPods installation failed"
    echo "💡 Try running: pod repo update && pod install"
    exit 1
fi

cd ..

echo "✅ iOS dependencies installed"

# Check if Capacitor is properly configured
if [ ! -f "capacitor.config.ts" ]; then
    echo "❌ Error: Capacitor configuration not found"
    exit 1
fi

echo "✅ Capacitor configuration found"

# Open Xcode project
echo "🔧 Opening Xcode project..."
echo "📋 Next steps in Xcode:"
echo "   1. Select 'App' target"
echo "   2. Go to 'Signing & Capabilities'"
echo "   3. Set your Apple Developer Team"
echo "   4. Ensure Bundle ID is 'com.vibecodes.app'"
echo "   5. Select 'Any iOS Device (arm64)'"
echo "   6. Product → Archive"
echo ""

# Ask if user wants to open Xcode
read -p "Open Xcode now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run ios:open
    echo "🎯 Xcode opened! Follow the steps above to archive your app."
else
    echo "💡 Run 'npm run ios:open' when ready to open Xcode"
fi

echo ""
echo "📖 See TESTFLIGHT-DEPLOYMENT.md for complete instructions"
echo "📋 Use TESTFLIGHT-CHECKLIST.md to track your progress"
echo ""
echo "🎉 Preparation complete! Ready for TestFlight deployment."
