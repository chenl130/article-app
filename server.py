#!/usr/bin/env python3
"""Local backend for Immigration Article Studio.

Serves the static prototype and provides small agent workflow endpoints backed
by the OpenAI Responses API. No third-party packages are required.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import socket
import ssl
import sys
import traceback
import urllib.error
import urllib.request
import uuid
import base64
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"
KNOWLEDGE_FILE = DATA_DIR / "knowledge.json"
GENERATED_IMAGES_DIR = ROOT / "generated-images"


def load_local_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()

OPENAI_API_URL = os.environ.get("OPENAI_API_URL", "https://api.openai.com/v1/responses")
OPENAI_IMAGE_API_URL = os.environ.get("OPENAI_IMAGE_API_URL", "https://api.openai.com/v1/images/generations")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
OPENAI_INSECURE_SSL = os.environ.get("OPENAI_INSECURE_SSL", "").lower() in {"1", "true", "yes"}
HOST = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1")
PORT = int(os.environ.get("PORT", "4173"))
BETA_PASSWORD = os.environ.get("BETA_PASSWORD") or os.environ.get("APP_PASSWORD") or os.environ.get("INTERNAL_BETA_PASSWORD")
SESSIONS: dict[str, dict[str, Any]] = {}


BASE_DEVELOPER_PROMPT = """你是一个为美国移民律所服务的 AI agent workflow。

总目标：
- 帮助律师和法律助理撰写中文移民类公众号文章、律所官网文章、客户简报和白皮书草稿。
- 输出必须体现资深美国移民律师的实务判断，而不是泛泛的 AI 总结。
- 你不是客户个案法律意见的最终发布者。所有内容都必须保留律师审阅空间。

写作风格：
- 中文为主，可以自然使用必要英文术语，例如 USCIS、DHS、RIA、RFE、NOID。
- 法律严谨、实务导向、适合中国读者。
- 不要使用“至关重要”“全面”“复杂环境”“赋能”“深度剖析”等空泛套话。
- 每个重要判断都要连接具体事实、实务后果、证据要求、时间窗口或审理心理。
- 避免承诺批准结果、资金返还结果、排期结果或任何个案结果。
- 对拟议规则、政策趋势、未经核实事实必须明确保留边界。

温勇公众号深度评论风格：
- 这不是普通法律科普文，而是“宏观叙事 + 政策风险 + 法律路径 + 行动建议”的公众号文章。
- 标题要有问题意识、时代感或文学化表达，避免“某某签证介绍”这类说明书标题。
- 开头先回答“为什么现在必须关注”，再进入签证或法律机制。
- 正文可以使用“风起何处”“制度如何传导到个人”“短期/中期/长期风险”“行动建议”等结构。
- 每节标题要像评论文章，不要像教材目录；但法律内容仍需准确。
- 语言应混合三层：公众号叙事语言、移民法律实务语言、战略判断语言。
- 对 TN/USMCA 类文章，必须区分：TN 当前仍是有效制度；USMCA 审查/谈判带来的是政策不确定性，不等于 TN 已被取消。
- 结尾要回到读者行动：身份转换、雇主沟通、材料准备、绿卡路径、时间窗口，而不是单纯营销。

温勇NIW严审时代系列风格：
- 适用于 EB-2 NIW、EB-1A、PERM、O-1、产业人才、企业家和高端职业移民规划文章。
- 核心不是基础科普，而是“严审时代下的战略判断”：从 Eligibility 到 Approvability，从 Yes/No 到 Now/Not Yet，从 Job/Career 到 Endeavor/Mission，从 Company Value 到 National Value，从 Petition Drafting 到 Career Building。
- 开头优先使用客户咨询中的真实问题或时代变化切入，例如“现在 NIW 是不是很难做了？”“没有论文还能不能做？”“现在递还是等六个月？”不要从 NIW 定义开始。
- 正文要围绕一个中心判断逐层推进，不要把五篇系列内容串在一起。每一篇只能回答一个主问题。
- 必须强调 NIW 不是奖励“优秀人士”的奖章，而是围绕 proposed endeavor、national importance、well positioned 和 waiver benefit 建立可审查的法律与证据逻辑。
- 对产业界申请人，要把内部岗位、公司项目、KPI、产品、流程、用户、客户、团队影响，转化为可归因、可验证、可扩散的 Impact，而不是简单堆材料。
- 可使用这些固定概念，但要自然嵌入：Field ≠ Endeavor；Job Description ≠ Endeavor；推荐信解释证据而不是替代证据；论文不是影响力，论文只是影响力留下的证据；不要制造材料，要成为材料所描述的人。
- 法律边界：不承诺批准，不用未经核验的批准率数据，不把律师经验说成官方结论。涉及 USCIS Policy Manual、Dhanasar、AILA RFE 趋势、批准率和政策日期时，必须保留“发布前由律师核验”的空间。
"""


ACTION_PROMPTS = {
    "tighten": "压缩冗余表达，删掉空泛铺垫，让每段更像资深律师的判断。保留原意。",
    "legal": "增强法律严谨性，补充限定语、拟议/已生效区分、律师审阅提示，删除过度承诺。",
    "wechat": "增强公众号吸引力，优化标题感、开篇节奏和可读性，但不夸大法律结论。",
    "risk": "加入实务风险感，从 USCIS 审理心理、证据链、客户执行难点角度补强。",
    "antiAi": "去 AI 味，删除机械对称结构和正确废话，加入更自然的句式和经验型判断。",
    "sanguo": "加入克制的三国风小标题和历史战局感，但不要让法律分析变成戏仿。",
    "poem": "在不影响专业度的前提下，加入一首适合作为结尾或破题的短诗。",
}


def read_json(handler: SimpleHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def send_json(
    handler: SimpleHTTPRequestHandler,
    status: int,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(body)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_cookies(handler: SimpleHTTPRequestHandler) -> dict[str, str]:
    cookie_header = handler.headers.get("Cookie", "")
    cookies: dict[str, str] = {}
    for part in cookie_header.split(";"):
        if "=" not in part:
            continue
        key, value = part.strip().split("=", 1)
        cookies[key] = value
    return cookies


def current_session(handler: SimpleHTTPRequestHandler) -> dict[str, Any] | None:
    if not BETA_PASSWORD:
        return {"userName": "local-user", "createdAt": now_iso()}
    token = parse_cookies(handler).get("ia_session")
    if not token:
        return None
    return SESSIONS.get(token)


def is_authenticated(handler: SimpleHTTPRequestHandler) -> bool:
    return current_session(handler) is not None


def login(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    if not BETA_PASSWORD:
        return {"authenticated": True, "userName": "local-user"}, {}
    password = str(payload.get("password") or "")
    if not secrets.compare_digest(password, BETA_PASSWORD):
        raise PermissionError("访问密码不正确。")
    user_name = str(payload.get("userName") or "内测成员").strip()[:40] or "内测成员"
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = {"userName": user_name, "createdAt": now_iso()}
    cookie = f"ia_session={token}; Path=/; SameSite=Lax; HttpOnly"
    return {"authenticated": True, "userName": user_name}, {"Set-Cookie": cookie}


def logout(handler: SimpleHTTPRequestHandler) -> tuple[dict[str, Any], dict[str, str]]:
    token = parse_cookies(handler).get("ia_session")
    if token:
        SESSIONS.pop(token, None)
    return {"authenticated": False}, {"Set-Cookie": "ia_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly"}


def get_lan_urls(port: int) -> list[str]:
    urls: set[str] = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, family=socket.AF_INET):
            address = info[4][0]
            if not address.startswith("127."):
                urls.add(f"http://{address}:{port}/")
    except OSError:
        pass
    return sorted(urls)


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(exist_ok=True)


def ensure_generated_images_dir() -> None:
    GENERATED_IMAGES_DIR.mkdir(exist_ok=True)


def load_json_file(path: Path, fallback: Any) -> Any:
    ensure_data_dir()
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def save_json_file(path: Path, value: Any) -> None:
    ensure_data_dir()
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def load_projects() -> dict[str, Any]:
    data = load_json_file(PROJECTS_FILE, {"projects": []})
    if not isinstance(data, dict) or not isinstance(data.get("projects"), list):
        return {"projects": []}
    return data


def save_projects(data: dict[str, Any]) -> None:
    save_json_file(PROJECTS_FILE, data)


def load_knowledge() -> dict[str, Any]:
    data = load_json_file(KNOWLEDGE_FILE, {"items": []})
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return {"items": []}
    return data


def save_knowledge(data: dict[str, Any]) -> None:
    save_json_file(KNOWLEDGE_FILE, data)


def project_summary(project: dict[str, Any]) -> dict[str, Any]:
    versions = project.get("versions", [])
    latest = versions[-1] if versions else {}
    snapshot = latest.get("snapshot", {}) if isinstance(latest, dict) else {}
    form = snapshot.get("form", {}) if isinstance(snapshot, dict) else {}
    return {
        "id": project.get("id"),
        "title": project.get("title") or form.get("topic") or "未命名项目",
        "category": form.get("category", ""),
        "audience": form.get("audience", ""),
        "owner": project.get("owner", ""),
        "latestActor": latest.get("actor", "") if isinstance(latest, dict) else "",
        "updatedAt": project.get("updatedAt"),
        "versionCount": len(versions),
        "latestReason": latest.get("reason", "") if isinstance(latest, dict) else "",
    }


def list_projects(_payload: dict[str, Any] | None = None) -> dict[str, Any]:
    projects = load_projects()["projects"]
    summaries = [project_summary(project) for project in projects if isinstance(project, dict)]
    summaries.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    return {"projects": summaries}


def save_project(payload: dict[str, Any]) -> dict[str, Any]:
    snapshot = payload.get("snapshot")
    if not isinstance(snapshot, dict):
        raise RuntimeError("Missing project snapshot.")

    form = snapshot.get("form", {}) if isinstance(snapshot.get("form"), dict) else {}
    project_id = payload.get("projectId") or snapshot.get("projectId") or f"proj_{uuid.uuid4().hex[:12]}"
    title = form.get("topic") or snapshot.get("title") or "未命名项目"
    user = snapshot.get("user", {}) if isinstance(snapshot.get("user"), dict) else {}
    actor = str(payload.get("userName") or user.get("name") or "未记录").strip()[:40] or "未记录"
    timestamp = now_iso()
    version = {
        "id": f"ver_{uuid.uuid4().hex[:12]}",
        "createdAt": timestamp,
        "reason": payload.get("reason") or "手动保存",
        "actor": actor,
        "snapshot": snapshot | {"projectId": project_id},
    }

    data = load_projects()
    projects = data["projects"]
    project = next((item for item in projects if isinstance(item, dict) and item.get("id") == project_id), None)
    if not project:
        project = {"id": project_id, "createdAt": timestamp, "versions": []}
        projects.append(project)

    project["title"] = title
    project["owner"] = project.get("owner") or actor
    project["updatedAt"] = timestamp
    project.setdefault("versions", []).append(version)
    save_projects(data)
    return {"project": project_summary(project), "version": version}


def load_project(payload: dict[str, Any]) -> dict[str, Any]:
    project_id = payload.get("projectId")
    version_id = payload.get("versionId")
    projects = load_projects()["projects"]
    project = next((item for item in projects if isinstance(item, dict) and item.get("id") == project_id), None)
    if not project:
        raise RuntimeError("Project not found.")
    versions = project.get("versions", [])
    if not versions:
        raise RuntimeError("Project has no saved versions.")
    version = None
    if version_id:
        version = next((item for item in versions if isinstance(item, dict) and item.get("id") == version_id), None)
    if not version:
        version = versions[-1]
    return {"project": project_summary(project), "versions": versions, "version": version}


def list_knowledge(_payload: dict[str, Any] | None = None) -> dict[str, Any]:
    items = load_knowledge()["items"]
    items = [item for item in items if isinstance(item, dict)]
    items.sort(key=lambda item: item.get("createdAt") or "", reverse=True)
    return {"items": items}


def save_knowledge_item(payload: dict[str, Any]) -> dict[str, Any]:
    title = str(payload.get("title") or "未命名素材").strip()
    content = str(payload.get("content") or "").strip()
    source_type = str(payload.get("sourceType") or "note").strip()
    if not content:
        raise RuntimeError("Knowledge content is empty.")
    item = {
        "id": f"kb_{uuid.uuid4().hex[:12]}",
        "title": title[:120],
        "content": content[:60000],
        "sourceType": source_type[:40],
        "createdAt": now_iso(),
    }
    data = load_knowledge()
    data["items"].append(item)
    save_knowledge(data)
    return {"item": item}


def extract_output_text(data: Any) -> str:
    if isinstance(data, dict):
        direct = data.get("output_text")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        chunks: list[str] = []
        for item in data.get("output", []) if isinstance(data.get("output"), list) else []:
            if not isinstance(item, dict):
                continue
            for content in item.get("content", []) if isinstance(item.get("content"), list) else []:
                if isinstance(content, dict):
                    text = content.get("text")
                    if isinstance(text, str):
                        chunks.append(text)
        if chunks:
            return "\n".join(chunks).strip()
    return ""


def strip_json_fence(text: str) -> str:
    text = text.strip()
    match = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, flags=re.S)
    return match.group(1).strip() if match else text


def parse_model_json(text: str) -> dict[str, Any]:
    cleaned = strip_json_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise


def create_ssl_context() -> ssl.SSLContext:
    if OPENAI_INSECURE_SSL:
        return ssl._create_unverified_context()

    cafile = os.environ.get("SSL_CERT_FILE")
    if not cafile:
        try:
            import certifi  # type: ignore[import-not-found]

            cafile = certifi.where()
        except ImportError:
            cafile = None

    if cafile:
        return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


def call_openai(agent_name: str, task_prompt: str, payload: dict[str, Any]) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("尚未设置 OPENAI_API_KEY。请设置后重启 server.py。")

    request_payload = {
        "model": OPENAI_MODEL,
        "reasoning": {"effort": "low"},
        "input": [
            {"role": "developer", "content": BASE_DEVELOPER_PROMPT},
            {
                "role": "developer",
                "content": f"当前 agent：{agent_name}\n\n{task_prompt}",
            },
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False, indent=2),
            },
        ],
    }

    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120, context=create_ssl_context()) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI API error {exc.code}: {error_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"OpenAI API network error: {exc.reason}") from exc

    text = extract_output_text(data)
    if not text:
        raise RuntimeError("OpenAI response did not contain text output.")
    return text


def call_openai_image(prompt: str, *, size: str = "1024x1536", quality: str = "medium") -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("尚未设置 OPENAI_API_KEY。请设置后重启 server.py。")

    request_payload = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": 1,
    }

    request = urllib.request.Request(
        OPENAI_IMAGE_API_URL,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180, context=create_ssl_context()) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI image API error {exc.code}: {detail}") from exc

    image_items = data.get("data", []) if isinstance(data, dict) else []
    if not image_items:
        raise RuntimeError("OpenAI image response did not contain image data.")
    image = image_items[0]
    if isinstance(image, dict) and image.get("b64_json"):
        ensure_generated_images_dir()
        image_bytes = base64.b64decode(image["b64_json"])
        filename = f"xhs_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
        output_path = GENERATED_IMAGES_DIR / filename
        output_path.write_bytes(image_bytes)
        return {
            "imageUrl": f"/generated-images/{filename}",
            "imagePath": str(output_path),
            "model": OPENAI_IMAGE_MODEL,
            "size": size,
            "quality": quality,
        }
    if isinstance(image, dict) and image.get("url"):
        return {
            "imageUrl": image["url"],
            "imagePath": "",
            "model": OPENAI_IMAGE_MODEL,
            "size": size,
            "quality": quality,
        }
    raise RuntimeError("OpenAI image response format was not recognized.")


def strategy_agent(payload: dict[str, Any]) -> dict[str, Any]:
    prompt = """作为 Article Architect Agent + Immigration Strategy Agent，生成文章策略。

如果 form.styleProfile 是“温勇NIW严审时代系列风格”，请优先采用“客户问题切入 + 核心判断 + 法律框架 + 证据工程 + 职业/事业建设 + 行动问题”的结构；每篇只回答一个中心问题，不要写成 NIW 入门百科。
如果 form.styleProfile 是“温勇公众号深度评论风格”，请优先采用宏观政策叙事、签证制度风险、个人应对策略三层结构。
如果 form.articleType 是“政策风险深度拆解”，应先写当前主题对应的政策背景，再讲该类别/该路径的风险传导，再给短中长期风险判断和行动方案；不得默认写 TN，除非 topic、category 或素材明确涉及 TN/USMCA。
如果 form.articleType 是“路径对比与行动建议”，应使用“核心机制/核心优势/核心要点风险/移民路径衔接/适用性”的段落模块。
如果 topic 或 category 涉及 TN/USMCA，请主动提示需要核验：USCIS TN 页面、CBP TN 页面、USTR USMCA 页面、USMCA 2026 review 最新状态；并区分加拿大公民和墨西哥公民的程序差异。

只输出 JSON，不要 markdown，不要解释。格式：
{
  "thesis": "核心论点，1段",
  "article_type": "推荐文章类型",
  "structure": ["5-7个结构要点"],
  "risks": ["3-5个风险与补强点"],
  "titles": ["3个标题建议"],
  "opening_direction": "开篇方向，1段",
  "agent_notes": ["给法律助理的操作提示"],
  "fact_check_targets": ["发布前必须核验的官方来源或事实点"],
  "followup_article_ideas": ["同一主题可继续写的2个后续选题"]
}
"""
    return parse_model_json(call_openai("Article Architect Agent", prompt, payload))


def draft_agent(payload: dict[str, Any]) -> dict[str, Any]:
    prompt = """作为 Draft Writer Agent，基于参数、素材和已生成策略撰写中文文章初稿。

要求：
- 输出完整文章，不要只写提纲。
- 如果 payload.selectedTitle 有值，必须把它作为文章标题，放在正文最前面；不要另起新标题。
- 标准深度约 1800-2400 中文字符；深度拆解约 2200-2800 中文字符，必须写成单篇可发布的公众号文章。
- 如果 form.depth 是 quick，或 form.articleType 是“短评快讯”，或用户材料明确要求少于1500字，正文必须控制在 900-1400 个中文字符左右。
- 如果 form.depth 是 deep，应聚焦当前主题展开，不要写成系列总览；每个核心判断都应有解释、实务后果、证据要求或客户行动建议支撑。
- 只写当前 payload.form.topic 对应的一篇文章；即使材料里提到系列、五篇文章或其他标题，也不得把多篇文章合并输出。
- 新闻快评不要写成完整深度长文：开头交代新闻信号，中段解释影响，结尾给行动建议即可。
- 面向微信公众号，但保留律所专业感。
- 如材料不足，不能编造具体官方日期、数据或案例；用“需发布前核验”提醒。
- 如果使用“温勇公众号深度评论风格”，开头不要从定义开始，要从政策气候、客户咨询变化、制度变化或时代背景开始。
- 如果使用“温勇NIW严审时代系列风格”，开头必须从客户咨询、申请人困惑、审理风向或职业成长问题切入；不得写成 NIW 条件介绍；必须围绕一个中心判断展开，并通过 Dhanasar 逻辑、证据工程、职业定位或 Impact 建设支撑。
- TN/USMCA 文章必须写清：TN 依托 USMCA/NAFTA 专业人员框架；加拿大公民通常可在口岸向 CBP 申请 TN status；墨西哥公民通常需先申请 TN visa；TN 是非移民身份且不等同于绿卡路径；USMCA review 带来不确定性但不是自动取消。
- 不要虚构最新政策。用户材料或知识库未给出的新闻/数据，只能写成“需发布前核验的趋势观察”。

只输出 JSON：
{
  "draft": "完整文章正文",
  "editor_notes": ["3-5条给律师/助理的后续编辑提醒"]
}
"""
    return parse_model_json(call_openai("Draft Writer Agent", prompt, payload))


def rewrite_agent(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action", "")
    action_prompt = ACTION_PROMPTS.get(action, "根据用户选择优化文章。")
    custom_instruction = str(payload.get("customInstruction") or "").strip()
    if custom_instruction:
        action_prompt = f"{action_prompt}\n\n用户自定义调整要求：{custom_instruction}"
    prompt = f"""作为 Style Agent + Risk Reviewer Agent，对现有草稿进行定向改稿。

改稿目标：{action_prompt}

要求：
- 直接返回改后的完整草稿，不要只给建议。
- 如果 payload.selectedTitle 有值，保留该标题作为正文最前面的标题，除非用户自定义调整明确要求修改标题。
- 保留文章的法律边界和事实核验提醒。
- 如果用户选择三国风或诗词，表达要克制，不能破坏律所专业感。

只输出 JSON：
{{
  "draft": "改后的完整草稿",
  "change_notes": ["3-5条说明本轮改动"]
}}
"""
    return parse_model_json(call_openai("Rewrite Agent", prompt, payload))


def review_agent(payload: dict[str, Any]) -> dict[str, Any]:
    prompt = """作为 Final Partner Review Agent，模拟忙碌的资深移民律师终审公众号文章。

要求：
- 不要重写全文。
- 输出必须简洁、高层、适合律师 1-2 分钟扫读。
- 每组最多 3 条 bullet，每条不超过 35 个中文字。
- 只保留影响能否发布的点：核心判断、必须核验、主要法律/营销风险、发布建议。
- 明确哪些点必须由律师最终判断；不要列助理层面的长清单。

只输出 JSON：
{
  "executive_summary": ["1-3条总体判断"],
  "must_check": ["1-3条必须核验"],
  "key_risks": ["1-3条主要风险"],
  "go_live_notes": ["1-3条发布建议"]
}
"""
    return parse_model_json(call_openai("Final Partner Review Agent", prompt, payload))


def social_agent(payload: dict[str, Any]) -> dict[str, Any]:
    prompt = """作为 Social Repurpose Agent，把已经写好的中文移民公众号文章改写成两个平台版本。

要求：
- 不要改变法律结论，不要夸大风险，不要制造恐慌。
- 小红书版本不是再写一篇文章，而是 5-10 张图片卡片脚本，每张卡片适合做成一张图片。
- 如果 form.depth 是 quick 或 form.articleType 是“短评快讯”，小红书版本必须控制在 3-4 张图片卡片。
- 每张小红书卡片必须包含：短标题、2-4行正文、视觉建议、底部小字提示。
- 小红书卡片应适合中文读者，表达更短、更有节奏，但仍保留律师谨慎感。
- LinkedIn 版本应更专业、克制，可用中文或中英混合，不要像微信公众号长文。
- LinkedIn 正文控制在 250-450 英文词；新闻快评要更短、更像 professional update。
- 如涉及 TN/USMCA，必须保留加拿大与墨西哥申请人的差异和事实核验边界。
- 如使用“温勇NIW严审时代系列风格”，小红书卡片要保留系列感，但每篇视觉必须围绕本篇独立概念设计，例如审批精审、路径选择、职业路线、影响力证据、六个月成长；封面应包含系列文章编号；不得每篇都使用同一种模板。

只输出 JSON：
{
  "xhs_title": "小红书笔记标题",
  "xhs_cards": [
    {
      "title": "卡片短标题",
      "body": "卡片正文，2-4行",
      "visual_direction": "图片设计建议",
      "footer": "底部小字"
    }
  ],
  "xhs_caption": "小红书发布文案",
  "linkedin_title": "LinkedIn标题",
  "linkedin_post": "LinkedIn正文",
  "linkedin_hashtags": ["3-6个hashtag"]
}
"""
    return parse_model_json(call_openai("Social Repurpose Agent", prompt, payload))


def knowledge_extract_agent(payload: dict[str, Any]) -> dict[str, Any]:
    article = str(payload.get("article") or "").strip()
    if not article:
        raise RuntimeError("Article content is empty.")
    title = str(payload.get("title") or "律师定稿").strip()
    category = str(payload.get("category") or "").strip()
    style_profile = str(payload.get("styleProfile") or "").strip()
    prompt = """作为 Law Firm Style Knowledge Extractor Agent，从一篇律师已经修改确认的终稿中提炼可复用写作规则。

目标：
- 不是总结文章内容，而是提炼后续写同类文章时可复用的判断方式、结构、语言和证据逻辑。
- 输出要能被知识库保存，并在后续写作时作为参考材料注入。
- 不要生成法律意见，不要引入原文没有的新事实。

请重点提炼：
- 标题策略：为什么这个标题成立，适合什么读者与系列位置。
- 开篇策略：如何从客户焦虑、政策变化或职业困惑切入。
- 核心论证：文章如何从一个中心问题逐层推进，而不是写成百科。
- 法律边界：如何使用 Dhanasar、USCIS、RFE、PERM、EB-1A/NIW 等术语时保留审阅空间。
- 证据工程：如何把材料从“我有什么”转成“这些证明什么”。
- 温律师风格：哪些句式、转折、追问方式、结尾方式值得复用。
- 小红书转化：这篇文章适合转成什么视觉风格，如何与其他系列卡片区分。
- 禁用表达：后续写作应该避免什么空话、承诺或模板化语言。

只输出 JSON：
{
  "title": "知识库标题",
  "content": "可直接保存进知识库的规则文本，使用清晰小标题和短段落，1200-1800中文字符",
  "tags": ["3-6个短标签"]
}
"""
    result = parse_model_json(
        call_openai(
            "Law Firm Style Knowledge Extractor Agent",
            prompt,
            {
                "title": title,
                "category": category,
                "styleProfile": style_profile,
                "article": article[:50000],
            },
        )
    )
    knowledge_title = str(result.get("title") or f"律师定稿规则：{title}").strip()
    tags = result.get("tags") if isinstance(result.get("tags"), list) else []
    tag_text = "、".join(str(tag) for tag in tags[:6])
    content = str(result.get("content") or "").strip()
    if tag_text:
        content = f"标签：{tag_text}\n\n{content}"
    return save_knowledge_item(
        {
            "title": knowledge_title,
            "content": content,
            "sourceType": "attorney-final-pattern",
        }
    )


def image_agent(payload: dict[str, Any]) -> dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise RuntimeError("Image prompt is empty.")
    size = str(payload.get("size") or "1024x1536")
    quality = str(payload.get("quality") or "medium")
    allowed_sizes = {"1024x1024", "1024x1536", "1536x1024", "auto"}
    allowed_quality = {"low", "medium", "high", "auto"}
    if size not in allowed_sizes:
        size = "1024x1536"
    if quality not in allowed_quality:
        quality = "medium"
    return call_openai_image(prompt, size=size, quality=quality)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:
        if self.path == "/api/status":
            session = current_session(self)
            send_json(
                self,
                HTTPStatus.OK,
                {
                    "ok": True,
                    "model": OPENAI_MODEL,
                    "imageModel": OPENAI_IMAGE_MODEL,
                    "apiKeyConfigured": bool(os.environ.get("OPENAI_API_KEY")),
                    "apiUrl": OPENAI_API_URL,
                    "host": HOST,
                    "port": PORT,
                    "lanUrls": get_lan_urls(PORT),
                    "authRequired": bool(BETA_PASSWORD),
                    "authenticated": bool(session),
                    "userName": session.get("userName") if session else "",
                },
            )
            return
        if self.path == "/api/projects":
            if not is_authenticated(self):
                send_json(self, HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "请先登录内测版本。"})
                return
            send_json(self, HTTPStatus.OK, {"ok": True, "result": list_projects()})
            return
        if self.path == "/api/knowledge":
            if not is_authenticated(self):
                send_json(self, HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "请先登录内测版本。"})
                return
            send_json(self, HTTPStatus.OK, {"ok": True, "result": list_knowledge()})
            return
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/login":
            try:
                result, headers = login(read_json(self))
                send_json(self, HTTPStatus.OK, {"ok": True, "result": result}, headers)
            except PermissionError as exc:
                send_json(self, HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                send_json(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})
            return
        if self.path == "/api/logout":
            result, headers = logout(self)
            send_json(self, HTTPStatus.OK, {"ok": True, "result": result}, headers)
            return
        routes = {
            "/api/articles/strategy": strategy_agent,
            "/api/articles/draft": draft_agent,
            "/api/articles/rewrite": rewrite_agent,
            "/api/articles/review": review_agent,
            "/api/articles/social": social_agent,
            "/api/images/generate": image_agent,
            "/api/projects/save": save_project,
            "/api/projects/load": load_project,
            "/api/knowledge/save": save_knowledge_item,
            "/api/knowledge/extract": knowledge_extract_agent,
        }
        if self.path not in routes:
            send_json(self, HTTPStatus.NOT_FOUND, {"error": "Unknown API route"})
            return
        if not is_authenticated(self):
            send_json(self, HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "请先登录内测版本。"})
            return

        try:
            payload = read_json(self)
            result = routes[self.path](payload)
            send_json(self, HTTPStatus.OK, {"ok": True, "result": result})
        except Exception as exc:  # noqa: BLE001 - local dev server should report details.
            traceback.print_exc()
            send_json(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    display_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
    print(f"Serving Immigration Article Studio on http://{display_host}:{PORT}")
    if HOST == "0.0.0.0":
        for url in get_lan_urls(PORT):
            print(f"LAN URL: {url}")
    print(f"OpenAI model: {OPENAI_MODEL}")
    print(f"OPENAI_API_KEY configured: {bool(os.environ.get('OPENAI_API_KEY'))}")
    print(f"Beta password enabled: {bool(BETA_PASSWORD)}")
    if HOST == "0.0.0.0" and not BETA_PASSWORD:
        print("WARNING: HOST=0.0.0.0 without BETA_PASSWORD exposes the app to the local network.")
    server.serve_forever()


if __name__ == "__main__":
    main()
