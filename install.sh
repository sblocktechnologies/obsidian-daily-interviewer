#!/bin/bash

# Obsidian Interviewer Plugin Installer
# Builds and installs the plugin to your Obsidian vault

PLUGIN_NAME="obsidian-daily-interviewer"

# Check if vault path provided as argument
if [ -n "$1" ]; then
    VAULT_PATH="$1"
elif [ -n "$OBSIDIAN_VAULT" ]; then
    # Use environment variable if set
    VAULT_PATH="$OBSIDIAN_VAULT"
else
    # Prompt user for vault path
    echo "Usage: ./install.sh <vault-path>"
    echo ""
    echo "Examples:"
    echo "  ./install.sh ~/my-vault"
    echo "  ./install.sh \"/Users/me/My Obsidian Vault\""
    echo ""
    echo "Or set OBSIDIAN_VAULT environment variable:"
    echo "  export OBSIDIAN_VAULT=~/my-vault"
    echo "  ./install.sh"
    exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_NAME"

# Verify vault exists
if [ ! -d "$VAULT_PATH/.obsidian" ]; then
    echo "Error: '$VAULT_PATH' doesn't appear to be an Obsidian vault (.obsidian folder not found)"
    exit 1
fi

echo "Building plugin..."
npm run build

if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

echo "Installing to: $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"

cp main.js "$PLUGIN_DIR/"
cp manifest.json "$PLUGIN_DIR/"
cp styles.css "$PLUGIN_DIR/"

echo "Done! Restart Obsidian or reload the plugin to see changes."
