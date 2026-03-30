---
title: "From IDE to Cloud: Lifting Your Local Agent into an MCP Server on Amazon Bedrock AgentCore"
description: "A practical guide to deploying a local Python MCP server to Amazon Bedrock AgentCore Runtime — from localhost prototype to production-grade cloud service with session isolation, authentication, and observability."
pubDate: 2026-03-03
category: "AWS & Cloud Architecture"
tags: ["ai", "aws", "python", "mcp", "bedrock", "agentcore"]
draft: false
---

This article walks through deploying a local Python MCP server to Amazon Bedrock AgentCore Runtime. The guide demonstrates how to take an agent prototype running on localhost and lift it into a production-grade cloud service with session isolation, authentication, and observability — all with minimal infrastructure work.

## Key Concepts

### Amazon Bedrock AgentCore Runtime

The service provides a serverless environment purpose-built for AI agents with several distinguishing features:

- **Framework flexibility**: Supports Strands Agents, LangGraph, CrewAI, or custom Python implementations without vendor lock-in
- **Model agnostic**: Works with Amazon Bedrock models, Anthropic Claude, Google Gemini, or OpenAI
- **Isolation**: Each session runs in a dedicated microVM with separate CPU, memory, and filesystem resources
- **Protocol support**: Native MCP and Agent-to-Agent (A2A) communication
- **Extended timeouts**: Synchronous calls support 15-minute limits; asynchronous sessions extend to 8 hours
- **Pay-per-use pricing**: Charges only for actual compute consumed

### Model Context Protocol (MCP)

MCP establishes an open standard for tool discovery and invocation. The protocol enables any MCP client to discover available tools at runtime and invoke them without custom integration. On AgentCore Runtime, servers listen on `0.0.0.0:8000/mcp` with stateless streamable-HTTP transport.

## Implementation Steps

### Step 1: Build Local MCP Server

The tutorial creates a FastMCP server with three example tools:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(host="0.0.0.0", stateless_http=True)

@mcp.tool()
def summarise_architecture(service_name: str) -> str:
    """Summarise the high-level architecture of an AWS service."""
    return f"The {service_name} architecture typically includes a control plane for management operations and a data plane for runtime request handling, with IAM for access control."

@mcp.tool()
def estimate_monthly_cost(service: str, requests_per_month: int, avg_duration_ms: int) -> str:
    """Estimate monthly cost for a serverless AWS service."""
    cost_per_request = 0.0000002
    cost_per_gb_second = 0.0000166667
    memory_gb = 0.5
    duration_seconds = avg_duration_ms / 1000
    compute_cost = requests_per_month * duration_seconds * memory_gb * cost_per_gb_second
    request_cost = requests_per_month * cost_per_request
    total = compute_cost + request_cost
    return f"Estimated monthly cost for {service}: ${total:,.2f}"

@mcp.tool()
def generate_iam_policy(actions: list[str], resource_arn: str) -> dict:
    """Generate a least-privilege IAM policy document."""
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": actions,
            "Resource": resource_arn,
        }],
    }
```

The server is tested locally before deployment using a Python client that discovers tools and invokes them via HTTP.

### Step 2: Install AgentCore MCP Server in IDE

Configure your MCP client (Claude Code, Cursor, or Kiro) with the AWS AgentCore MCP server. For Claude Code, add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "bedrock-agentcore-mcp-server": {
      "command": "uvx",
      "args": ["awslabs.amazon-bedrock-agentcore-mcp-server@latest"],
      "env": {"FASTMCP_LOG_LEVEL": "ERROR"},
      "disabled": false,
      "autoApprove": ["search_agentcore_docs", "fetch_agentcore_doc"]
    }
  }
}
```

### Step 3: Transform Agent for AgentCore

For FastMCP servers, minimal transformation is needed since they already meet protocol requirements. For general agents, wrap with the AgentCore SDK:

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@app.entrypoint
def handler(event, context):
    user_prompt = event.get("prompt", "")
    response = my_agent.run(user_prompt)
    return {"result": response}

if __name__ == "__main__":
    app.run()
```

### Step 4: Deploy to AgentCore Runtime

Two CLI commands execute the deployment:

**Configure:**

```bash
agentcore configure -e my_mcp_server.py --protocol MCP
```

This guides you through specifying an IAM execution role, ECR repository (auto-created if needed), dependency file detection, and optional OAuth configuration.

**Launch:**

```bash
agentcore launch
```

Behind the scenes, this command builds an ARM64 Docker container, pushes it to Amazon ECR, creates an AgentCore Runtime resource, and deploys the MCP server to an isolated microVM environment. On success, you receive an Agent Runtime ARN.

### Step 5: Invoke Deployed Server

With the Agent Runtime ARN and bearer token, invoke the remote server:

```python
import asyncio
import os
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main():
    agent_arn = os.getenv("AGENT_ARN")
    bearer_token = os.getenv("BEARER_TOKEN")

    encoded_arn = agent_arn.replace(":", "%3A").replace("/", "%2F")
    mcp_url = f"https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
    headers = {
        "authorization": f"Bearer {bearer_token}",
        "Content-Type": "application/json",
    }

    async with streamablehttp_client(mcp_url, headers, timeout=120) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("generate_iam_policy", {
                "actions": ["s3:GetObject", "s3:PutObject"],
                "resource_arn": "arn:aws:s3:::my-bucket/*",
            })
            print(f"Generated policy:\n{result.content[0].text}")

asyncio.run(main())
```

## Prerequisites

- AWS account with AgentCore permissions
- Configured AWS CLI
- Python 3.10+
- `uv` package manager (recommended)
- MCP client (Claude Code, Cursor, Kiro, or Amazon Q CLI)
- Core packages: `mcp`, `bedrock-agentcore`, `bedrock-agentcore-starter-toolkit`

## Next Steps

Once deployed:

- **AgentCore Gateway**: Connect to external APIs through the managed gateway
- **AgentCore Memory**: Add persistent conversation context across sessions
- **AgentCore Identity**: Integrate corporate identity providers for end-user authentication
- **Agent-to-Agent (A2A)**: Deploy additional agents with A2A protocol communication
- **Observability**: Enable built-in tracing via CloudWatch Transaction Search

## References

- [AWS Bedrock AgentCore Runtime Documentation](https://docs.aws.amazon.com/bedrock-agentcore/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/specification)
- [AWS Bedrock AgentCore Samples (GitHub)](https://github.com/awslabs/amazon-bedrock-agentcore-samples)

---

*Originally published on [Dev.to](https://dev.to/tsekatm/from-ide-to-cloud-lifting-your-local-agent-into-an-mcp-server-on-amazon-bedrock-agentcore-3icp)*
