import asyncio
import json
import os
import sys
import traceback
from typing import Any, Callable, Coroutine, Iterable, Sequence

_current_line = 0

def _trace_lines(frame, event, arg):
    """
    Trace function to track line-by-line execution of user code.
    """
    global _current_line

    if event != "line":
        return _trace_lines

    if frame.f_code.co_name == "user_main":
        lineno = frame.f_lineno
        _current_line = lineno
        try:
            print(json.dumps({"type": "execution_progress", "line": lineno, "total_lines": 0}), flush=True)
        except Exception:
            pass

    return _trace_lines

class _PtcHelpers:
    def __init__(self, max_parallel_tool_calls: int):
        self.max_parallel_tool_calls = max(1, max_parallel_tool_calls)

    async def gather_limit(self, coroutines: Iterable[Coroutine[Any, Any, Any]], limit: int | None = None):
        semaphore = asyncio.Semaphore(max(1, limit or self.max_parallel_tool_calls))

        async def _runner(coro: Coroutine[Any, Any, Any]):
            async with semaphore:
                return await coro

        return await asyncio.gather(*[_runner(coro) for coro in coroutines])

    async def find_files(self, pattern: str, path: str = ".", limit: int = 1000) -> Sequence[str]:
        return await glob(pattern=pattern, path=path, limit=limit)

    async def find_files_abs(self, pattern: str, path: str = ".", limit: int = 1000) -> Sequence[str]:
        files = await self.find_files(pattern=pattern, path=path, limit=limit)
        base_path = os.path.abspath(path)
        return [item if os.path.isabs(item) else os.path.join(base_path, item) for item in files]

    async def read_text(self, path: str, offset: int | None = None, limit: int | None = None) -> str:
        return await read(path=path, offset=offset, limit=limit)

    async def read_many(
        self,
        paths: Sequence[str],
        limit: int | None = None,
        offset: int | None = None,
        line_limit: int | None = None,
    ) -> Sequence[str]:
        return await self.gather_limit(
            [read(path=path, offset=offset, limit=line_limit) for path in paths],
            limit=limit,
        )

    async def read_tree(
        self,
        pattern: str,
        path: str = ".",
        limit: int = 1000,
        concurrency: int | None = None,
        offset: int | None = None,
        line_limit: int | None = None,
    ) -> Sequence[dict[str, Any]]:
        files = await self.find_files_abs(pattern=pattern, path=path, limit=limit)
        contents = await self.read_many(files, limit=concurrency, offset=offset, line_limit=line_limit)
        return [
            {
                "path": file_path,
                "content": content,
            }
            for file_path, content in zip(files, contents)
        ]

    def json_dump(self, value: Any) -> str:
        return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)

ptc = _PtcHelpers(globals().get("PTC_MAX_PARALLEL_TOOL_CALLS", 8))

def _stringify_output(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list, tuple, bool, int, float)):
        return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)
    return str(value)

async def _runtime_main(user_main: Callable[[], Coroutine[Any, Any, Any]]):
    """
    Runtime entry point that executes user code with RPC support.
    """
    try:
        await _rpc.start_reader()
        sys.settrace(_trace_lines)
        output = await user_main()
        sys.settrace(None)
        print(json.dumps({"type": "complete", "output": _stringify_output(output)}), flush=True)
    except Exception as error:
        sys.settrace(None)
        print(
            json.dumps(
                {
                    "type": "error",
                    "message": str(error),
                    "traceback": traceback.format_exc(),
                }
            ),
            flush=True,
        )
        sys.exit(1)
    finally:
        await _rpc.cleanup()
