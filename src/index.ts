#!/usr/bin/env node
import { promises as fs } from 'fs';
import { resolve, isAbsolute } from 'path';
import sharp from 'sharp';
import fetch from 'node-fetch';

// MCP Types
interface ServerInfo {
  name: string;
  version: string;
}

interface ServerCapabilities {
  tools: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

interface McpRequest<T> {
  params: T;
}

interface ListToolsRequest {}

interface CallToolRequest {
  name: string;
  arguments: Record<string, unknown>;
}

interface McpResponse<T> {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

class McpError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'McpError';
  }
}

const OPENAI_API_BASE = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function analyzeImage(imagePath: string, question?: string, model?: string): Promise<string> {
  // Validate absolute path
  if (!isAbsolute(imagePath)) {
    throw new McpError(
      'InvalidParams',
      'Image path must be absolute'
    );
  }

  try {
    const imageBuffer = await fs.readFile(imagePath);
    console.error('Successfully read image buffer of size:', imageBuffer.length);
    
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    console.error('Image metadata:', metadata);
    
    // Calculate dimensions to keep base64 size reasonable
    const MAX_DIMENSION = 400;
    const JPEG_QUALITY = 60;
    let resizedBuffer = imageBuffer;
    
    if (metadata.width && metadata.height) {
      const largerDimension = Math.max(metadata.width, metadata.height);
      if (largerDimension > MAX_DIMENSION) {
        const resizeOptions = metadata.width > metadata.height
          ? { width: MAX_DIMENSION }
          : { height: MAX_DIMENSION };
        
        resizedBuffer = await sharp(imageBuffer)
          .resize(resizeOptions)
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer();
      } else {
        resizedBuffer = await sharp(imageBuffer)
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer();
      }
    }

    const base64Image = resizedBuffer.toString('base64');
    
    // Analyze with OpenAI-compatible API
    const requestBody = {
      model: model || DEFAULT_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: question || "What's in this image?"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ]
    };

    console.error('Sending request to OpenAI-compatible API...');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (OPENAI_API_KEY) {
      headers['Authorization'] = `Bearer ${OPENAI_API_KEY}`;
    }

    const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    console.error('Response status:', response.status);
    
    const responseText = await response.text();
    console.error('Response text:', responseText);
    
    if (!response.ok) {
      throw new Error(`OpenAI-compatible API error: ${response.statusText}\nDetails: ${responseText}`);
    }

    const analysis = JSON.parse(responseText);
    console.error('OpenAI-compatible API response:', JSON.stringify(analysis, null, 2));

    const choice = analysis.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('No completion choices returned by the API');
    }

    const messageContent = choice.message.content;
    if (typeof messageContent === 'string') {
      return messageContent;
    }

    if (Array.isArray(messageContent)) {
      const textParts = messageContent
        .map((part: unknown) => {
          if (typeof part === 'string') {
            return part;
          }
          if (typeof part === 'object' && part !== null && 'type' in part) {
            const typedPart = part as { type?: string; text?: string };
            if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
              return typedPart.text;
            }
          }
          return '';
        })
        .filter((text: string) => text.length > 0);

      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }

    throw new Error('Completion response did not contain text content');
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

class ImageAnalysisServer {
  private info: ServerInfo;
  private capabilities: ServerCapabilities;
  private handlers: Map<string, (request: any) => Promise<any>>;

  constructor() {
    this.info = {
      name: 'read-images',
      version: '0.1.0',
    };
    this.capabilities = {
      tools: {},
    };
    this.handlers = new Map();

    this.setupHandlers();
    
    process.on('SIGINT', () => {
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    // List Tools Handler
    this.handlers.set('list_tools', async (_request: McpRequest<ListToolsRequest>) => ({
      tools: [
        {
          name: 'analyze_image',
          description: `Analyze an image using an OpenAI-compatible vision model (default: ${DEFAULT_MODEL})`,
          inputSchema: {
            type: 'object',
            properties: {
              image_path: {
                type: 'string',
                description: 'Path to the image file to analyze (must be absolute path)'
              },
              question: {
                type: 'string',
                description: 'Question to ask about the image'
              },
              model: {
                type: 'string',
                description: `Model to use (e.g., ${DEFAULT_MODEL})`
              }
            },
            required: ['image_path']
          }
        }
      ]
    }));

    // Call Tool Handler
    this.handlers.set('call_tool', async (request: McpRequest<CallToolRequest>) => {
      if (request.params.name !== 'analyze_image') {
        throw new McpError(
          'MethodNotFound',
          `Unknown tool: ${request.params.name}`
        );
      }

      const args = request.params.arguments as {
        image_path: string;
        question?: string;
        model?: string;
      };

      try {
        const result = await analyzeImage(args.image_path, args.question, args.model);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        return {
          content: [
            {
              type: 'text',
              text: `Error analyzing image: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        };
      }
    });
  }

  async handleRequest(method: string, params: any): Promise<any> {
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new McpError('MethodNotFound', `Unknown method: ${method}`);
    }
    return handler({ params });
  }

  async run(): Promise<void> {
    process.stdin.setEncoding('utf8');
    
    let buffer = '';
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      
      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) break;
        
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        
        try {
          const request = JSON.parse(line);
          this.handleRequest(request.method, request.params)
            .then(result => {
              const response = {
                id: request.id,
                result
              };
              process.stdout.write(JSON.stringify(response) + '\n');
            })
            .catch(error => {
              const response = {
                id: request.id,
                error: {
                  code: error instanceof McpError ? error.code : 'InternalError',
                  message: error.message
                }
              };
              process.stdout.write(JSON.stringify(response) + '\n');
            });
        } catch (error) {
          console.error('Error processing request:', error);
        }
      }
    });

    console.error('Image Analysis MCP server running on stdio');
  }
}

const server = new ImageAnalysisServer();
server.run().catch(console.error);
