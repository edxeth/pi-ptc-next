import asyncio
import json
import sys
from typing import Any, Dict, Optional

class RpcClient:
    """RPC client for calling tools from Python code."""

    def __init__(self):
        self.call_id = 0
        self.pending_calls: Dict[str, asyncio.Future[Any]] = {}
        self.reader_task: Optional[asyncio.Task[Any]] = None

    async def start_reader(self) -> None:
        """Start background task to read responses from stdin."""
        self.reader_task = asyncio.create_task(self._stdin_reader())

    async def _stdin_reader(self) -> None:
        """Read responses from stdin and dispatch them to pending calls."""
        try:
            loop = asyncio.get_event_loop()
            reader = asyncio.StreamReader()
            protocol = asyncio.StreamReaderProtocol(reader)
            await loop.connect_read_pipe(lambda: protocol, sys.stdin)

            while True:
                line = await reader.readline()
                if not line:
                    break

                try:
                    response = json.loads(line.decode().strip())
                    self._handle_response(response)
                except json.JSONDecodeError as error:
                    print(f"JSON decode error: {error}", file=sys.stderr)
                except Exception as error:
                    print(f"Error handling response: {error}", file=sys.stderr)
        except asyncio.CancelledError:
            pass
        except Exception as error:
            print(f"stdin reader error: {error}", file=sys.stderr)

    def _handle_response(self, response: Dict[str, Any]) -> None:
        call_id = response.get("id")
        if call_id and call_id in self.pending_calls:
            future = self.pending_calls[call_id]
            if not future.done():
                if response.get("error"):
                    future.set_exception(Exception(response["error"]))
                else:
                    future.set_result(response.get("value"))
            del self.pending_calls[call_id]

    async def call(self, tool: str, params: Dict[str, Any]) -> Any:
        self.call_id += 1
        call_id = f"call_{self.call_id}"
        request = {
            "type": "tool_call",
            "id": call_id,
            "tool": tool,
            "params": params,
        }
        print(json.dumps(request), flush=True)

        future: asyncio.Future[Any] = asyncio.Future()
        self.pending_calls[call_id] = future

        try:
            return await asyncio.wait_for(future, timeout=300.0)
        except asyncio.TimeoutError as error:
            if call_id in self.pending_calls:
                del self.pending_calls[call_id]
            raise Exception(f"Tool call '{tool}' timed out") from error

    async def cleanup(self) -> None:
        if self.reader_task:
            self.reader_task.cancel()
            try:
                await self.reader_task
            except asyncio.CancelledError:
                pass

_rpc = RpcClient()

async def _rpc_call(tool: str, params: Dict[str, Any]) -> Any:
    """Call a tool via RPC and return the JSON-compatible normalized value."""
    return await _rpc.call(tool, params)
