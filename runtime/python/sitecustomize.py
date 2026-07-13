"""Hermes Desktop ACP runtime fixes loaded through PYTHONPATH."""

from __future__ import annotations

import os


DEFAULT_PERMISSION_TIMEOUT_SECONDS = 315_360_000.0


def _configured_permission_timeout() -> float:
    raw = os.environ.get("HERMES_ACP_PERMISSION_TIMEOUT_SECONDS", "").strip()
    if raw:
        try:
            return max(float(raw), 0.0)
        except (TypeError, ValueError):
            pass

    try:
        from tools.approval import _get_approval_timeout

        return max(float(_get_approval_timeout()), 0.0)
    except Exception:
        return DEFAULT_PERMISSION_TIMEOUT_SECONDS


def _patch_acp_permission_timeouts() -> None:
    try:
        from acp_adapter import permissions

        original = permissions.make_approval_callback
        if not getattr(original, "_hermes_desktop_timeout_patch", False):
            def make_approval_callback(
                request_permission_fn,
                loop,
                session_id,
                timeout=None,
            ):
                effective_timeout = _configured_permission_timeout() if timeout is None else timeout
                return original(
                    request_permission_fn,
                    loop,
                    session_id,
                    timeout=effective_timeout,
                )

            make_approval_callback._hermes_desktop_timeout_patch = True
            permissions.make_approval_callback = make_approval_callback
    except Exception:
        pass

    try:
        from acp_adapter import edit_approval

        original_edit = edit_approval.make_acp_edit_approval_requester
        if not getattr(original_edit, "_hermes_desktop_timeout_patch", False):
            def make_acp_edit_approval_requester(
                request_permission_fn,
                loop,
                session_id,
                timeout=None,
                auto_approve_getter=None,
            ):
                effective_timeout = _configured_permission_timeout() if timeout is None else timeout
                return original_edit(
                    request_permission_fn,
                    loop,
                    session_id,
                    timeout=effective_timeout,
                    auto_approve_getter=auto_approve_getter,
                )

            make_acp_edit_approval_requester._hermes_desktop_timeout_patch = True
            edit_approval.make_acp_edit_approval_requester = make_acp_edit_approval_requester
    except Exception:
        pass


def _expand_skill_prompt_text(text: str, session_id: str) -> str | None:
    if not text.startswith("/"):
        return None

    from agent.skill_commands import (
        build_skill_invocation_message,
        build_stacked_skill_invocation_message,
        resolve_skill_command_key,
        scan_skill_commands,
        split_stacked_skill_commands,
    )

    parts = text.split(maxsplit=1)
    command = parts[0].lstrip("/")
    rest = parts[1].strip() if len(parts) > 1 else ""
    scan_skill_commands()
    command_key = resolve_skill_command_key(command)
    if not command_key:
        return None

    extra_keys, instruction = split_stacked_skill_commands(rest)
    if extra_keys:
        stacked = build_stacked_skill_invocation_message(
            [command_key, *extra_keys],
            instruction,
            task_id=session_id,
        )
        return stacked[0] if stacked else None

    return build_skill_invocation_message(
        command_key,
        rest,
        task_id=session_id,
    )


def _patch_acp_skill_commands() -> None:
    try:
        from acp.schema import TextContentBlock
        from acp_adapter.server import HermesACPAgent, _extract_text

        original_prompt = HermesACPAgent.prompt
        if getattr(original_prompt, "_hermes_desktop_skills_patch", False):
            return

        async def prompt(self, prompt, session_id, **kwargs):
            text = _extract_text(prompt).strip()
            text_only = all(isinstance(block, TextContentBlock) for block in prompt)
            if text_only and text.startswith("/"):
                expanded = _expand_skill_prompt_text(text, session_id)
                if expanded:
                    prompt = [TextContentBlock(type="text", text=expanded)]

            return await original_prompt(self, prompt=prompt, session_id=session_id, **kwargs)

        prompt._hermes_desktop_skills_patch = True
        HermesACPAgent.prompt = prompt
    except Exception:
        pass


_patch_acp_permission_timeouts()
_patch_acp_skill_commands()
