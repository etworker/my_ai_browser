# VOA - Visual Operation Assistant

## 需求文档

**版本**: 1.0  
**日期**: 2026-04-20  
**状态**: 进行中

---

## 1. 引言

### 1.1 项目概述

VOA（Visual Operation Assistant）是一款基于 Tauri 2.x 构建的桌面应用程序，通过 AI 辅助帮助用户在复杂 Web 控制台（如 AWS、Azure、GCP）上完成操作流程。用户描述目标后，系统分析页面元素，通过 AI 自主决策定位目标位置，并指导用户完成操作。

### 1.2 核心功能摘要

- **本地优先 AI 架构**：优先使用 Ollama 本地模型，降低成本并保护隐私
- **内置浏览器**：集成 WebView，支持 DOM 提取和页面交互
- **AI 自主决策引擎**：LLM 自动判断使用 DOM（精确）还是视觉（语义理解）
- **可视化引导系统**：高亮层和提示框直观指示操作位置
- **跨平台支持**：支持 Windows、macOS、Linux

### 1.3 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Tauri 2.x |
| 前端 | HTML + CSS + JavaScript (TypeScript) |
| 后端 | Rust |
| AI 引擎 | Ollama / OpenAI API |
| 屏幕捕获 | screenshots crate |
| 窗口管理 | WebviewWindow API |

---

## 2. 词汇表

| 术语 | 定义 |
|------|------|
| **VOA** | Visual Operation Assistant，视觉化操作助手 |
| **WebView** | Tauri 嵌入的网页视图组件 |
| **主窗口** | VOA 应用的主窗口（label: "main"），包含对话界面和布局 |
| **浏览器窗口** | VOA 用于浏览网页的窗口（label: "browser"） |
| **高亮层** | 半透明覆盖层，用于在屏幕元素上形成视觉引导 |
| **目标元素** | 用户下一步应点击或交互的页面元素 |
| **选择器** | CSS 选择器或 XPath，用于精确定位 DOM 元素 |
| **AI 决策** | LLM 分析页面后做出的下一步操作判断 |
| **自动模式** | VOA 自动分析、决策、执行操作的模式 |
| **手动模式** | 用户自行操作，VOA 提供指导和建议 |
| **DOM 提取** | 从 WebView 获取页面 DOM 结构的过程 |
| **坐标校准** | 将 WebView 坐标映射到实际屏幕坐标的过程 |

---

## 3. 需求

### 3.1 窗口与布局

**用户故事：** AS a user, I want the application to display browser and chat in a single window, so that I can browse and get guidance in one place.

#### Acceptance Criteria

1. THE VOA application SHALL display a single main window containing both the browser area and the chat panel.
2. THE layout SHALL position the browser area on the left side and the chat panel on the right side.
3. THE browser area SHALL occupy at least 60% of the window width.
4. THE chat panel SHALL have a fixed width between 320px and 400px.
5. THE main window SHALL have a minimum size of 1000x700 pixels.
6. THE main window SHALL be resizable by the user.

---

### 3.2 浏览器功能

**用户故事：** AS a user, I want to browse websites within the application, so that I can access web content while getting AI guidance.

#### Acceptance Criteria

1. WHEN user enters a URL in the address bar and clicks "Go", VOA SHALL navigate to the specified URL.
2. WHEN navigation occurs, VOA SHALL update the address bar with the current URL.
3. THE browser SHALL support back and forward navigation using webview history.
4. THE browser SHALL support page refresh.
5. WHEN page loading starts, VOA SHALL display a loading indicator.
6. WHEN page loading completes, VOA SHALL fire a `did-finish-load` event.
7. WHEN page loading fails, VOA SHALL fire a `did-fail-load` event with error description.
8. THE browser SHALL support clicking on links and interacting with form elements.
9. VOA SHALL extract DOM structure including interactive elements (buttons, links, inputs).

---

### 3.3 DOM 提取

**用户故事：** AS the system, I need to extract the DOM structure from the browser, so that I can identify interactive elements for AI analysis.

#### Acceptance Criteria

1. VOA SHALL extract all interactive elements including: buttons, links, inputs, selects, textareas, and elements with click handlers.
2. FOR each extracted element, VOA SHALL capture: tag name, text content, bounding rect (x, y, width, height), CSS selector, href (for links), type (for inputs), and placeholder.
3. VOA SHALL limit extracted elements to 60 per page to manage performance.
4. VOA SHALL extract page title and current URL along with DOM data.
5. THE DOM extraction SHALL occur automatically when page navigation completes in auto mode.
6. VOA SHALL emit an event containing the extracted data to the Rust backend.

---

### 3.4 AI 对话界面

**用户故事：** AS a user, I want to communicate with VOA through natural language, so that I can describe my goals and receive guidance.

#### Acceptance Criteria

1. VOA SHALL provide a text input field for user to enter natural language commands.
2. VOA SHALL display chat messages in a scrollable container.
3. VOA SHALL distinguish between user messages and assistant responses using visual styling.
4. WHEN user sends a message, VOA SHALL add it to the chat history.
5. VOA SHALL process user input and generate AI responses.
6. VOA SHALL maintain conversation context across multiple exchanges.
7. THE chat interface SHALL display AI status (model name, connection state).

---

### 3.5 AI 引擎（本地优先）

**用户故事：** AS a user, I want VOA to use local AI when possible, so that I can save costs and protect privacy.

#### Acceptance Criteria

1. VOA SHALL first attempt to use Ollama running locally (localhost:11434) for AI processing.
2. VOA SHALL use the configured model (default: `gemma4:e2b`).
3. WHEN local Ollama is unavailable, VOA SHALL fall back to cloud AI (OpenAI GPT-4o-mini).
4. VOA SHALL display which AI model is currently active.
5. WHEN AI processing fails, VOA SHALL display an error message in the chat.
6. THE AI engine SHALL support sending messages with conversation history.
7. THE AI engine SHALL return confidence scores with responses.

---

### 3.6 AI 自主决策

**用户故事:** AS the system, I need to analyze page content and decide the next action automatically, so that I can guide users through workflows without manual intervention.

#### Acceptance Criteria

1. WHEN page DOM is extracted, VOA SHALL send the data to AI for analysis.
2. THE AI prompt SHALL include: user goal, page title, URL, and list of interactive elements.
3. VOA SHALL expect AI to return a decision in JSON format containing:
   - `action`: click | type | navigate | wait | done | need_vision | error
   - `target_selector`: CSS selector for target element (for click/type)
   - `navigate_url`: URL to navigate to (for navigate)
   - `wait_seconds`: seconds to wait (for wait)
   - `reason`: explanation of the decision
   - `confidence`: 0.0-1.0 confidence score
   - `summary`: brief summary of the action
4. WHEN AI returns `done`, VOA SHALL display completion message.
5. WHEN AI returns `click` or `type`, VOA SHALL highlight the target element.
6. WHEN AI returns `navigate`, VOA SHALL navigate to the specified URL.
7. WHEN confidence is below 0.5, VOA SHALL request user confirmation before executing.

---

### 3.7 自动模式与手动模式

**用户故事:** AS a user, I want to choose between automatic execution and manual control, so that I can adapt to different situations.

#### Acceptance Criteria

1. VOA SHALL provide a toggle button to switch between auto mode and manual mode.
2. IN auto mode:
   - VOA SHALL automatically analyze page after navigation
   - VOA SHALL automatically execute AI decisions after a brief delay
   - VOA SHALL automatically advance to next step after action completion
3. IN manual mode:
   - VOA SHALL analyze page on user request
   - VOA SHALL highlight target elements but wait for user confirmation
   - User SHALL click "Continue" to proceed to next step
4. WHEN user says "Stop" or "Exit", VOA SHALL exit auto mode and clear the current goal.
5. THE mode indicator SHALL be visible in the chat panel.

---

### 3.8 可视化高亮系统

**用户故事:** AS a user, I want to see visual indicators on screen, so that I know exactly where to click without guessing.

#### Acceptance Criteria

1. WHEN AI decides on a target element, VOA SHALL highlight the element with a visual effect.
2. THE highlight SHALL consist of a colored border (default: purple #667eea) around the target element.
3. VOA SHALL display a tooltip near the highlighted element showing the action hint.
4. THE highlight SHALL remain visible for at least 5 seconds or until the action is executed.
5. WHEN a new target is identified, VOA SHALL clear the previous highlight and apply a new one.
6. VOA SHALL support clearing all highlights on demand.

---

### 3.9 浏览器事件处理

**用户故事:** AS the system, I need to handle browser events from the WebView, so that I can track navigation and page state changes.

#### Acceptance Criteria

1. VOA SHALL listen for `did-start-loading` events to track when page loading begins.
2. VOA SHALL listen for `did-finish-load` events to track when page loading completes.
3. VOA SHALL listen for `did-fail-load` events to track when page loading fails with error details.
4. VOA SHALL listen for `did-navigate` events to track main frame navigation.
5. VOA SHALL listen for `did-navigate-in-page` events to track in-page navigation (e.g., SPA routing).
6. IN auto mode, VOA SHALL trigger DOM extraction and analysis after navigation completes.

---

### 3.10 屏幕捕获

**用户故事:** AS a user, I want the system to capture screenshots, so that I can have visual records or use them for additional analysis.

#### Acceptance Criteria

1. VOA SHALL support capturing the entire screen using the screenshots crate.
2. THE capture SHALL return image data in PNG format encoded as base64.
3. THE capture SHALL return screen dimensions along with the image.
4. WHEN capture fails, VOA SHALL return an appropriate error message.
5. THIS feature SHALL be callable via Tauri command `capture_screen`.

---

### 3.11 日志系统

**用户故事:** AS a user, I want to see application logs in the UI, so that I can debug issues and understand what the system is doing.

#### Acceptance Criteria

1. VOA SHALL display a log panel in the chat section below the chat messages.
2. THE log panel SHALL show timestamped entries with different log levels: info, success, error.
3. VOA SHALL log all browser navigation events.
4. VOA SHALL log all AI decisions and actions.
5. VOA SHALL log all errors with error details.
6. VOA SHALL provide a "Clear" button to clear the log panel.
7. LOG entries SHALL be styled with appropriate colors (blue for info, green for success, red for error).

---

### 3.12 Rust 命令接口

**用户故事:** AS the frontend, I need to communicate with the Rust backend through commands, so that I can access native functionality.

#### Acceptance Criteria

1. VOA SHALL expose the following Tauri commands:
   - `capture_screen`: Capture screen and return image data
   - `analyze_page`: Send page data to backend for processing
   - `set_auto_mode`: Enable or disable auto mode
   - `create_browser_webview`: Create a new browser window with URL
   - `navigate_browser`: Navigate existing browser window to URL
   - `close_browser`: Close the browser window
   - `show_highlight`: Display highlight on target element
   - `hide_highlight`: Clear all highlights
   - `execute_browser_action`: Execute click/type action in browser
2. ALL commands SHALL return `Result<T, String>` for error handling.
3. ASYNC commands SHALL properly handle errors and propagate them to the frontend.

---

### 3.13 配置管理

**用户故事:** AS a user, I want to configure AI settings, so that I can customize the behavior according to my needs.

#### Acceptance Criteria

1. VOA SHALL support configuring the Ollama endpoint URL (default: http://localhost:11434).
2. VOA SHALL support configuring the Ollama model name (default: gemma4:e2b).
3. VOA SHALL support configuring the fallback threshold for AI confidence (default: 0.6).
4. VOA SHALL support providing an OpenAI API key for cloud fallback.
5. Configuration SHALL be stored in the AI module and accessible via API.

---

### 3.14 错误处理

**用户故事:** AS a user, I want to see clear error messages when something goes wrong, so that I can understand and resolve issues.

#### Acceptance Criteria

1. WHEN AI is unavailable, VOA SHALL display: "AI 未就绪。请启动 Ollama 或检查网络连接。"
2. WHEN browser navigation fails, VOA SHALL display the error in the log panel with error details.
3. WHEN DOM extraction fails, VOA SHALL log the error and skip the analysis for that page.
4. WHEN AI returns an invalid response, VOA SHALL display: "AI 响应格式错误，请重试。"
5. ALL error messages SHALL be displayed in the user's preferred language (Simplified Chinese).

---

### 3.15 项目结构

**用户故事:** AS a developer, I want clear project structure documentation, so that I can understand and maintain the codebase.

#### Acceptance Criteria

1. THE project SHALL follow the Tauri 2.x standard project structure.
2. THE frontend code SHALL be located in `src/` directory.
3. THE Rust backend code SHALL be located in `src-tauri/src/` directory.
4. THE main HTML entry point SHALL be `index.html` at project root.
5. THE Tauri configuration SHALL be in `src-tauri/tauri.conf.json`.
6. THE Rust dependencies SHALL be in `src-tauri/Cargo.toml`.
7. THE frontend dependencies SHALL be in `package.json`.

---

## 4. 数据结构

### 4.1 ScreenRegion

```rust
pub struct ScreenRegion {
    pub x: f64,           // X coordinate
    pub y: f64,           // Y coordinate
    pub width: f64,       // Width
    pub height: f64,      // Height
}
```

### 4.2 CaptureResult

```rust
pub struct CaptureResult {
    pub image_base64: String,  // Base64 encoded PNG image
    pub width: u32,            // Screen width
    pub height: u32,           // Screen height
}
```

### 4.3 PageData

```rust
pub struct PageData {
    pub title: String,                    // Page title
    pub url: String,                       // Current URL
    pub elements: Vec<PageElement>,         // Interactive elements
    pub html: String,                       // HTML snippet
}
```

### 4.4 PageElement

```rust
pub struct PageElement {
    pub tag: String,               // HTML tag name
    pub text: String,               // Element text content
    pub rect: ScreenRegion,         // Bounding rectangle
    pub selector: String,           // CSS selector
    pub href: Option<String>,        // Link URL (if applicable)
    #[serde(rename = "type")]
    pub input_type: Option<String>, // Input type (if applicable)
    pub placeholder: Option<String>, // Placeholder text (if applicable)
}
```

### 4.5 AIDecision

```typescript
interface AIDecision {
    action: 'click' | 'type' | 'navigate' | 'wait' | 'done' | 'need_vision' | 'error';
    target_selector?: string;
    target_text?: string;
    input_value?: string;
    navigate_url?: string;
    wait_seconds?: number;
    reason: string;
    confidence: number;
    summary: string;
}
```

---

## 5. 验收标准检查清单

### 5.1 核心功能

- [ ] 主窗口正确显示，包含浏览器区域和对话面板
- [ ] 浏览器可以在 WebView 中加载网页
- [ ] 地址栏输入 URL 后点击"前往"可以导航
- [ ] 前进/后退/刷新按钮正常工作
- [ ] DOM 提取功能返回页面元素列表
- [ ] AI 对话界面可以发送消息并接收响应
- [ ] 自动模式/手动模式切换正常工作

### 5.2 AI 功能

- [ ] Ollama 本地模型连接正常
- [ ] AI 决策引擎可以分析页面并返回 JSON 决策
- [ ] 高亮系统可以标记目标元素
- [ ] AI 响应置信度低于阈值时有确认提示

### 5.3 用户体验

- [ ] 日志面板显示操作日志
- [ ] 错误消息清晰易懂
- [ ] 界面布局响应式调整
- [ ] 键盘快捷键正常工作（Enter 发送消息）

### 5.4 技术要求

- [ ] Rust 后端编译通过，无警告
- [ ] 前端资源正确加载
- [ ] Tauri 命令正确注册和调用
- [ ] 跨平台打包成功（Windows/macOS/Linux）

---

## 6. 已知限制

1. **WebView 嵌入问题**：Tauri 2.x 的 `<webview>` 标签在前端设置 `src` 属性不生效，需要通过 Rust 端动态创建窗口
2. **跨域限制**：某些网站（如百度）设置了 `X-Frame-Options: SAMEORIGIN`，不允许被 iframe 嵌入
3. **macOS GTK 问题**：在某些 Linux 环境中需要 GTK 库支持

---

## 7. 参考资料

- [Tauri 2.x 官方文档](https://tauri.app/)
- [Ollama API 文档](https://github.com/ollama/ollama)
- [EARS 需求编写规范](https://earscardboard.com/)
- [INCOSE 语义质量规则](https://www.incose.org/)
