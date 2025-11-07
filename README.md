# MCP Read Images

An MCP server for analyzing images using any OpenAI-compatible chat completion API. This server provides a simple interface to analyze images by sending them to models that support multimodal prompts.

## Installation

```bash
npm install @catalystneuro/mcp_read_images
```

## Configuration

The server expects three environment variables that describe the OpenAI-compatible endpoint you want to use:

* `OPENAI_API_BASE` – The base URL of the API, including the `/v1` suffix (e.g. `https://api.openai.com/v1` or `http://localhost:11434/v1`).
* `OPENAI_API_KEY` – Optional API key that will be sent in the `Authorization` header. Leave empty if your endpoint does not require authentication.
* `OPENAI_MODEL` – Default model name to use when one is not supplied in the tool call.

Add the server to your MCP settings file (usually located at `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` for VSCode):

```json
{
  "mcpServers": {
    "read_images": {
      "command": "read_images",
      "env": {
        "OPENAI_API_BASE": "https://api.openai.com/v1",
        "OPENAI_API_KEY": "your-api-key-here", // optional
        "OPENAI_MODEL": "gpt-4o-mini" // optional, defaults to gpt-4o-mini
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Usage

The server provides a single tool `analyze_image` that can be used to analyze images:

```typescript
// Basic usage with default model
use_mcp_tool({
  server_name: "read_images",
  tool_name: "analyze_image",
  arguments: {
    image_path: "/path/to/image.jpg",
    question: "What do you see in this image?"  // optional
  }
});

// Using a specific model for this call
use_mcp_tool({
  server_name: "read_images",
  tool_name: "analyze_image",
  arguments: {
    image_path: "/path/to/image.jpg",
    question: "What do you see in this image?",
    model: "gpt-4.1-mini"  // overrides default and settings
  }
});
```

### Model Selection

The model is selected in the following order of precedence:
1. Model specified in the tool call (`model` argument)
2. Model specified in MCP settings (`OPENAI_MODEL` environment variable)
3. Default model (`gpt-4o-mini`)
## Features

- Automatic image resizing and optimization
- Configurable model selection
- Support for custom questions about images
- Detailed error messages
- Automatic JPEG conversion and quality optimization

## Development

To build from source:

```bash
git clone https://github.com/catalystneuro/mcp_read_images.git
cd mcp_read_images
npm install
npm run build
```

## License

MIT License. See [LICENSE](LICENSE) for details.
