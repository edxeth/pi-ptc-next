import type { TSchema } from "@sinclair/typebox";
import type { ToolInfo } from "./types";

function schemaToPythonType(schema: TSchema): string {
  const kind = (schema as { type?: string }).type;

  switch (kind) {
    case "string":
      return "str";
    case "number":
      return "float";
    case "integer":
      return "int";
    case "boolean":
      return "bool";
    case "array": {
      const items = (schema as { items?: TSchema }).items;
      const itemType = items ? schemaToPythonType(items) : "Any";
      return `List[${itemType}]`;
    }
    case "object":
      return "Dict[str, Any]";
    case "null":
      return "None";
    default:
      return "Any";
  }
}

function isOptional(schema: TSchema): boolean {
  const anyOf = (schema as unknown as { anyOf?: TSchema[] }).anyOf;
  if (anyOf) {
    return anyOf.some((entry) => (entry as { type?: string }).type === "null");
  }
  return false;
}

function extractNonNullSchema(schema: TSchema): TSchema {
  const anyOf = (schema as unknown as { anyOf?: TSchema[] }).anyOf;
  if (anyOf) {
    return anyOf.find((entry) => (entry as { type?: string }).type !== "null") || schema;
  }
  return schema;
}

function pythonReturnTypeForTool(toolName: string): string {
  switch (toolName) {
    case "read":
      return "str";
    case "find":
    case "glob":
    case "ls":
      return "List[str]";
    case "grep":
      return "List[Dict[str, Any]]";
    case "bash":
    case "edit":
    case "write":
      return "Dict[str, Any]";
    default:
      return "Any";
  }
}

function buildParamsDictionary(paramNames: string[]): string {
  if (paramNames.length === 0) {
    return "    params = {}";
  }

  return `    params = _ptc_drop_none({\n${paramNames
    .map((paramName) => `        ${JSON.stringify(paramName)}: ${paramName}`)
    .join(",\n")}\n    })`;
}

interface WrapperParamMetadata {
  signature: string;
  docs: string;
  name: string;
}

function buildWrapperParamMetadata(tool: ToolInfo): WrapperParamMetadata[] {
  const params = ((tool.parameters as { properties?: Record<string, TSchema> })?.properties) || {};
  const required = new Set(((tool.parameters as { required?: string[] })?.required) || []);

  return Object.entries(params).map(([paramName, paramSchema]) => {
    const schema = paramSchema as TSchema;
    const optional = !required.has(paramName) || isOptional(schema);
    const actualSchema = isOptional(schema) ? extractNonNullSchema(schema) : schema;
    const pythonType = schemaToPythonType(actualSchema);
    return {
      signature: optional ? `${paramName}: Optional[${pythonType}] = None` : `${paramName}: ${pythonType}`,
      docs: `        ${paramName}: ${(schema as { description?: string }).description || ""}`,
      name: paramName,
    };
  });
}

function buildFunctionSignature(name: string, returnType: string, params: WrapperParamMetadata[]): string {
  const requiredParams = params.filter((entry) => !entry.signature.includes("= None"));
  const optionalParams = params.filter((entry) => entry.signature.includes("= None"));

  let signature = `async def ${name}(`;
  if (requiredParams.length > 0) {
    signature += `\n    ${requiredParams.map((entry) => entry.signature).join(",\n    ")}`;
    if (optionalParams.length > 0) {
      signature += `,\n    *,\n    ${optionalParams.map((entry) => entry.signature).join(",\n    ")}`;
    }
  } else if (optionalParams.length > 0) {
    signature += `\n    *,\n    ${optionalParams.map((entry) => entry.signature).join(",\n    ")}`;
  }

  return `${signature}\n) -> ${returnType}:`;
}

function buildFunctionDocstring(description: string, returnType: string, params: WrapperParamMetadata[]): string {
  const argsBlock = params.length > 0 ? `    Args:\n${params.map((entry) => entry.docs).join("\n")}\n` : "";
  return `    """
    ${description.split("\n").join("\n    ")}

${argsBlock}    Returns:
        ${returnType}
    """`;
}

function buildGenericToolWrapper(tool: ToolInfo): string {
  const pythonName = tool.ptc?.pythonName || tool.name;
  const returnType = pythonReturnTypeForTool(tool.name);
  const params = buildWrapperParamMetadata(tool);
  const signature = buildFunctionSignature(pythonName, returnType, params);
  const docstring = buildFunctionDocstring(tool.description || `Execute ${tool.name}`, returnType, params);
  const paramsDict = buildParamsDictionary(params.map((entry) => entry.name));

  return `${signature}
${docstring}
${paramsDict}
    return await _rpc_call(${JSON.stringify(tool.name)}, params)`;
}

function buildReadWrapper(): string {
  return `async def read(
    path: Optional[str] = None,
    *,
    file_path: Optional[str] = None,
    offset: Optional[int] = None,
    limit: Optional[int] = None,
) -> str:
    """
    Read a text or image file.

    Args:
        path: Path to the file to read.
        file_path: Alias for path. Useful for compatibility with older examples.
        offset: 1-indexed line offset.
        limit: Maximum number of lines to read.

    Returns:
        str
    """
    resolved_path = path or file_path
    if resolved_path is None:
        raise ValueError("read() requires path=... or file_path=...")
    params = _ptc_drop_none({
        "path": resolved_path,
        "offset": offset,
        "limit": limit,
    })
    return await _rpc_call("read", params)`;
}

export function generateToolWrappers(tools: ToolInfo[]): string {
  const imports = `from typing import Optional, List, Dict, Any`;
  const helpers = `

def _ptc_drop_none(params: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in params.items() if value is not None}
`;

  const wrappers = tools.map((tool) => {
    if (tool.name === "read") {
      return buildReadWrapper();
    }
    return buildGenericToolWrapper(tool);
  });

  return `${imports}${helpers}\n\n${wrappers.join("\n\n")}`;
}
