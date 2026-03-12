import asyncio as _ptc_asyncio
import json as _ptc_json
import os as _ptc_os
import sys as _ptc_sys
import traceback as _ptc_traceback
from typing import Any, Callable, Coroutine, Iterable, Sequence

_current_line = 0
_PTC_HOST_WORKSPACE_ROOT = globals().get("PTC_HOST_WORKSPACE_ROOT", _ptc_os.getcwd())
_PTC_RUNTIME_WORKSPACE_ROOT = globals().get("PTC_RUNTIME_WORKSPACE_ROOT", _ptc_os.getcwd())
_PTC_USER_CODE_LINE_COUNT = globals().get("PTC_USER_CODE_LINE_COUNT", 0)
_ORIGINAL_STDOUT = _ptc_sys.stdout


def _emit_protocol(message: dict[str, Any]) -> None:
    _ORIGINAL_STDOUT.write(_ptc_json.dumps(message) + "\n")
    _ORIGINAL_STDOUT.flush()


_ptc_protocol_write = _emit_protocol


class _StdoutProxy:
    def __init__(self):
        self._buffer = ""

    def write(self, text: str) -> int:
        if not text:
            return 0

        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            _emit_protocol({"type": "stdout", "text": f"{line}\n"})
        return len(text)

    def flush(self) -> None:
        if self._buffer:
            _emit_protocol({"type": "stdout", "text": self._buffer})
            self._buffer = ""


_stdout_proxy = _StdoutProxy()


def _trace_lines(frame, event, arg):
    global _current_line

    if event != "line":
        return _trace_lines

    if frame.f_code.co_name == "user_main":
        lineno = frame.f_lineno - frame.f_code.co_firstlineno + 1
        _current_line = lineno
        try:
            _emit_protocol({"type": "execution_progress", "line": lineno, "total_lines": _PTC_USER_CODE_LINE_COUNT})
        except Exception:
            pass

    return _trace_lines


def _host_abspath(path: str) -> str:
    if _ptc_os.path.isabs(path):
        runtime_root = _ptc_os.path.normpath(_PTC_RUNTIME_WORKSPACE_ROOT)
        normalized = _ptc_os.path.normpath(path)
        if normalized == runtime_root or normalized.startswith(f"{runtime_root}{_ptc_os.sep}"):
            relative_path = _ptc_os.path.relpath(normalized, runtime_root)
            return _ptc_os.path.normpath(_ptc_os.path.join(_PTC_HOST_WORKSPACE_ROOT, relative_path))
        return normalized

    return _ptc_os.path.normpath(_ptc_os.path.join(_PTC_HOST_WORKSPACE_ROOT, path))


class _PtcHelpers:
    def __init__(self, max_parallel_tool_calls: int):
        self.max_parallel_tool_calls = max(1, max_parallel_tool_calls)

    async def gather_limit(self, coroutines: Iterable[Coroutine[Any, Any, Any]], limit: int | None = None):
        semaphore = _ptc_asyncio.Semaphore(max(1, limit or self.max_parallel_tool_calls))

        async def _runner(coro: Coroutine[Any, Any, Any]):
            async with semaphore:
                return await coro

        return await _ptc_asyncio.gather(*[_runner(coro) for coro in coroutines])

    async def find_files(self, pattern: str, path: str = ".", max_files: int = 1000) -> Sequence[str]:
        return await glob(pattern=pattern, path=path, limit=max_files)

    async def find_files_abs(self, pattern: str, path: str = ".", max_files: int = 1000) -> Sequence[str]:
        files = await self.find_files(pattern=pattern, path=path, max_files=max_files)
        base_path = _host_abspath(path)
        return [item if _ptc_os.path.isabs(item) else _ptc_os.path.join(base_path, item) for item in files]

    async def read_text(self, path: str, offset: int | None = None, limit: int | None = None) -> str:
        return await read(path=path, offset=offset, limit=limit)

    async def read_many(
        self,
        paths: Sequence[str],
        max_concurrency: int | None = None,
        *,
        offset: int | None = None,
        line_limit: int | None = None,
    ) -> Sequence[str]:
        return await self.gather_limit(
            [read(path=path, offset=offset, limit=line_limit) for path in paths],
            limit=max_concurrency,
        )

    async def read_tree(
        self,
        pattern: str,
        path: str = ".",
        max_files: int = 1000,
        concurrency: int | None = None,
        offset: int | None = None,
        line_limit: int | None = None,
    ) -> Sequence[dict[str, Any]]:
        files = await self.find_files_abs(pattern=pattern, path=path, max_files=max_files)
        contents = await self.read_many(files, max_concurrency=concurrency, offset=offset, line_limit=line_limit)
        return [
            {
                "path": file_path,
                "content": content,
            }
            for file_path, content in zip(files, contents)
        ]

    def json_dump(self, value: Any) -> str:
        return _ptc_json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)


ptc = _PtcHelpers(globals().get("PTC_MAX_PARALLEL_TOOL_CALLS", 8))


def _stringify_output(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list, tuple, bool, int, float)):
        return _ptc_json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)
    return str(value)


async def _runtime_main(user_main: Callable[[], Coroutine[Any, Any, Any]]):
    try:
        await _rpc.start_reader()
        _ptc_sys.settrace(_trace_lines)
        _ptc_sys.stdout = _stdout_proxy
        output = await user_main()
        _stdout_proxy.flush()
        _ptc_sys.stdout = _ORIGINAL_STDOUT
        _ptc_sys.settrace(None)
        _emit_protocol({"type": "complete", "output": _stringify_output(output)})
    except Exception as error:
        _ptc_sys.stdout = _ORIGINAL_STDOUT
        _ptc_sys.settrace(None)
        _emit_protocol(
            {
                "type": "error",
                "message": str(error),
                "traceback": _ptc_traceback.format_exc(),
            }
        )
        _ptc_sys.exit(1)
    finally:
        await _rpc.cleanup()
