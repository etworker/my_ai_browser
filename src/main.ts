import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { extractScreenText, findTextRegion, OCRResult } from "./ocr";
import { checkAIStatus, classifyUserIntent, sendMessage, ChatMessage } from "./ai";
import { loadCalibration, applyCalibration } from "./calibration";
import { visionModule, getScreenContext, parseAIResponse } from "./vision";

interface CaptureResult {
    image_base64: string;
    width: number;
    height: number;
}

interface ScreenRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface WorkflowStep {
    action: string;
    target: string;
    hint: string;
    expectedText?: string;
}

interface Workflow {
    name: string;
    platform: string;
    steps: WorkflowStep[];
}

interface InteractiveElement {
    tag: string;
    text: string;
    rect: ScreenRegion;
    selector: string;
}

interface DOMInfo {
    title: string;
    url: string;
    interactive_elements: InteractiveElement[];
}

class VOAApp {
    private statusEl: HTMLElement;
    private workflowInfoEl: HTMLElement;
    private stepInfoEl: HTMLElement;
    private chatContainer: HTMLElement;
    private userInput: HTMLTextAreaElement;
    private sendBtn: HTMLButtonElement;
    private openBrowserBtn: HTMLButtonElement;
    private captureBtn: HTMLButtonElement;
    private calibrateBtn: HTMLButtonElement;
    private toggleOverlayBtn: HTMLButtonElement;
    private testHighlightBtn: HTMLButtonElement;
    
    private isOverlayVisible = false;
    private messages: ChatMessage[] = [];
    private currentWorkflow: Workflow | null = null;
    private currentStep = 0;
    private lastOCRResult: OCRResult | null = null;
    private currentPlatform = 'generic';
    private currentDOM: DOMInfo | null = null;
    private isBrowserOpen = false;

    constructor() {
        this.statusEl = document.getElementById("status")!;
        this.workflowInfoEl = document.getElementById("workflow-info")!;
        this.stepInfoEl = document.getElementById("step-info")!;
        this.chatContainer = document.getElementById("chat-container")!;
        this.userInput = document.getElementById("user-input") as HTMLTextAreaElement;
        this.sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
        this.openBrowserBtn = document.getElementById("open-browser-btn") as HTMLButtonElement;
        this.captureBtn = document.getElementById("capture-btn") as HTMLButtonElement;
        this.calibrateBtn = document.getElementById("calibrate-btn") as HTMLButtonElement;
        this.toggleOverlayBtn = document.getElementById("toggle-overlay-btn") as HTMLButtonElement;
        this.testHighlightBtn = document.getElementById("test-highlight-btn") as HTMLButtonElement;

        this.init();
    }

    private async init() {
        this.sendBtn.addEventListener("click", () => this.handleSend());
        this.userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
        
        this.openBrowserBtn?.addEventListener("click", () => this.handleOpenBrowser());
        this.captureBtn.addEventListener("click", () => this.handleCapture());
        this.calibrateBtn.addEventListener("click", () => this.handleCalibrate());
        this.toggleOverlayBtn.addEventListener("click", () => this.toggleOverlay());
        this.testHighlightBtn.addEventListener("click", () => this.testHighlight());

        this.setupEventListeners();
        await this.checkAIStatus();

        console.log("VOA 应用已初始化");
    }

    private setupEventListeners() {
        listen('browser-capture', (event) => {
            const { screenshot, url } = event.payload;
            visionModule.setScreenshot({ screenshot, url, timestamp: Date.now() });
            this.addChatMessage("assistant", `页面捕获成功！\nURL: ${url}\n\n现在可以告诉我下一步想做什么。`);
        });

        listen('browser-dom', (event) => {
            const { dom, url } = event.payload;
            this.currentDOM = dom;
            visionModule.setDOM(dom);
            this.addChatMessage("assistant", 
                `DOM 获取成功！\n页面: ${dom.title}\n可交互元素: ${dom.interactive_elements.length}个\n\n现在可以告诉我您想点击什么，或者说"下一步"开始工作流。`
            );
        });
    }

    private async checkAIStatus() {
        try {
            const status = await checkAIStatus();
            if (status.available) {
                this.addChatMessage("assistant", 
                    `VOA 视觉化操作助手已就绪！\n\n` +
                    `AI 模型: ${status.model}\n` +
                    `使用方法:\n` +
                    `1. 点击"打开浏览器"按钮\n` +
                    `2. 在内置浏览器中访问 AWS 等网站\n` +
                    `3. 点击"获取DOM"捕获页面元素\n` +
                    `4. 描述您想完成的任务，AI 会指导您操作`
                );
            } else {
                this.addChatMessage("assistant", 
                    `AI 引擎未启动。请确保 Ollama 正在运行:\n` +
                    `\`\`\`bash\nollama serve\nollama pull gemma4:e2b\n\`\`\``
                );
            }
        } catch (e) {
            console.warn("AI 状态检查失败:", e);
        }
    }

    private async handleSend() {
        const input = this.userInput.value.trim();
        if (!input) return;

        this.addChatMessage("user", input);
        this.userInput.value = "";

        this.setStatus("思考中...");
        
        try {
            const response = await this.processUserInput(input);
            this.addChatMessage("assistant", response);
        } catch (error) {
            this.addChatMessage("assistant", `抱歉，发生了错误：${error}`);
        }

        this.setStatus("就绪");
    }

    private async processUserInput(input: string): Promise<string> {
        const lower = input.toLowerCase();

        if (lower.includes("打开") && (lower.includes("浏览器") || lower.includes("browser"))) {
            return this.handleOpenBrowser();
        }

        if (lower.includes("aws") || lower.includes("ec2") || lower.includes("启动") || lower.includes("创建")) {
            this.currentWorkflow = {
                name: "AWS EC2 启动流程",
                platform: "aws",
                steps: [
                    { action: "点击", target: "服务搜索框", hint: "在 AWS 控制台顶部搜索框中输入 'EC2'" },
                    { action: "点击", target: "EC2 选项", hint: "点击搜索结果中的 'EC2'" },
                    { action: "点击", target: "启动实例按钮", hint: "点击 '启动实例' 按钮" },
                    { action: "选择", target: "AMI", hint: "选择一个 Amazon Machine Image (AMI)" },
                    { action: "选择", target: "实例类型", hint: "选择实例类型（如 t2.micro）" },
                    { action: "配置", target: "实例详情", hint: "配置实例详情" },
                    { action: "添加", target: "存储", hint: "添加存储卷" },
                    { action: "配置", target: "安全组", hint: "配置安全组规则" },
                    { action: "审核", target: "启动审核", hint: "审核配置并点击 '启动'" },
                    { action: "选择", target: "密钥对", hint: "选择或创建密钥对，然后点击 '启动实例'" }
                ]
            };
            this.currentPlatform = 'aws';
            this.currentStep = 0;
            this.updateWorkflowInfo();
            this.updateStepInfo();
            
            return `好的，我将帮助您完成"${this.currentWorkflow.name}"。\n\n` +
                `当前步骤 (1/${this.currentWorkflow.steps.length})：\n` +
                `${this.currentWorkflow.steps[0].hint}\n\n` +
                `请确保浏览器已打开并加载了 AWS 控制台。`;
        }

        if (lower.includes("下一步") || lower.includes("继续") || lower.includes("指导")) {
            return await this.handleNextStep();
        }

        if (lower.includes("点击") && this.currentDOM) {
            return await this.handleClickElement(input);
        }

        if (lower.includes("上一步") || lower.includes("返回")) {
            if (!this.currentWorkflow || this.currentStep === 0) {
                return "无法返回上一步。";
            }
            
            this.currentStep--;
            this.updateStepInfo();
            const step = this.currentWorkflow.steps[this.currentStep];
            
            return `已返回上一步 (${this.currentStep + 1}/${this.currentWorkflow.steps.length})：\n${step.hint}`;
        }

        if (lower.includes("退出") || lower.includes("取消")) {
            if (this.currentWorkflow) {
                this.currentWorkflow = null;
                this.currentStep = 0;
                this.updateWorkflowInfo();
                this.updateStepInfo();
                return "已退出当前工作流。";
            }
            return "当前没有正在执行的工作流。";
        }

        if (lower.includes("校准")) {
            return this.handleCalibrate();
        }

        try {
            const intent = await classifyUserIntent(input);
            return `我理解您想: ${intent.intent}\n\n置信度: ${(intent.confidence * 100).toFixed(0)}%\n\n请告诉我更具体的操作。`;
        } catch (e) {
            return `我理解您想做"${input}"。\n\n请打开浏览器并获取 DOM 后，告诉我您想完成的任务。`;
        }
    }

    private async handleNextStep(): Promise<string> {
        if (!this.currentWorkflow) {
            return "您还没有选择任何工作流。请先告诉我您想做什么，比如"我想在 AWS 上启动 EC2"。";
        }
        
        const step = this.currentWorkflow.steps[this.currentStep];
        
        if (!this.currentDOM) {
            return `当前步骤 (${this.currentStep + 1}/${this.currentWorkflow.steps.length})：\n${step.hint}\n\n请先在浏览器中打开目标页面，然后点击"获取DOM"按钮。`;
        }

        const prompt = visionModule.generatePromptForStep(step.hint);
        
        try {
            const response = await sendMessage([
                { role: "system", content: "你是一个网页操作助手。根据用户意图和页面元素信息，返回下一步应该点击的元素。" },
                { role: "user", content: prompt }
            ]);

            const analysis = parseAIResponse(response.content);

            if (analysis && analysis.target_element) {
                const target = analysis.target_element;
                
                await invoke("highlight_element", {
                    selector: target.selector,
                    hint: step.hint
                });

                await new Promise(resolve => setTimeout(resolve, 500));

                this.addChatMessage("assistant", 
                    `已定位目标: [${target.tag}] "${target.text}"\n\n` +
                    `操作提示: ${step.hint}\n\n` +
                    `点击元素后告诉我"下一步"继续。`
                );
            } else {
                return `当前步骤 (${this.currentStep + 1}/${this.currentWorkflow.steps.length})：\n${step.hint}\n\nAI 置信度较低，请在页面上手动找到并点击正确的元素。`;
            }
        } catch (e) {
            console.error("AI 分析失败:", e);
            return `当前步骤 (${this.currentStep + 1}/${this.currentWorkflow.steps.length})：\n${step.hint}\n\nAI 分析失败，请在页面上手动找到并点击正确的元素。`;
        }

        return "";
    }

    private async handleClickElement(input: string): Promise<string> {
        if (!this.currentDOM) {
            return "请先点击"获取DOM"获取页面元素信息。";
        }

        const clickMatch = input.match(/点击[时分]?(.+)/);
        if (!clickMatch) {
            return "请说"点击[元素名称]"，比如"点击启动实例"。";
        }

        const targetText = clickMatch[1].trim();

        for (const el of this.currentDOM.interactive_elements) {
            if (el.text.includes(targetText) || targetText.includes(el.text)) {
                try {
                    await invoke("highlight_element", {
                        selector: el.selector,
                        hint: `点击 ${el.text}`
                    });

                    return `已高亮 "${el.text}"。\n\n确认后我将自动点击此元素，或者您可以手动点击。`;
                } catch (e) {
                    return `高亮失败: ${e}`;
                }
            }
        }

        return `未找到包含"${targetText}"的元素。请尝试其他描述。`;
    }

    private async handleOpenBrowser(): Promise<string> {
        try {
            await invoke("open_browser_window");
            this.isBrowserOpen = true;
            return "浏览器窗口已打开。请在浏览器中访问您想操作的网站（如 AWS 控制台），然后点击"获取DOM"捕获页面元素。";
        } catch (e) {
            return `打开浏览器失败: ${e}`;
        }
    }

    private async handleCapture() {
        this.setStatus("捕获屏幕中...");
        
        try {
            const result = await invoke<CaptureResult>("capture_screen");
            console.log(`屏幕捕获成功: ${result.width}x${result.height}`);
            
            const img = document.createElement("img");
            img.src = `data:image/png;base64,${result.image_base64}`;
            img.className = "captured-image";
            img.style.maxHeight = "300px";
            
            this.chatContainer.appendChild(img);
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
            
            this.setStatus("就绪");
            this.addChatMessage("assistant", `屏幕捕获成功！分辨率: ${result.width}x${result.height}。`);
        } catch (error) {
            this.setStatus("错误");
            this.addChatMessage("assistant", `屏幕捕获失败：${error}`);
        }
    }

    private async handleCalibrate(): Promise<string> {
        return `校准功能说明:\n\n` +
            `校准用于提高元素定位精度。\n\n` +
            `使用方法:\n` +
            `1. 在目标网站（如 AWS 控制台）上点击一个已知元素\n` +
            `2. 在聊天框中输入: 校准 x=100 y=200 (元素的实际屏幕坐标)\n` +
            `3. 重复 3 次不同元素\n` +
            `4. 系统会自动计算坐标变换矩阵`;
    }

    private async toggleOverlay() {
        try {
            if (this.isOverlayVisible) {
                await this.hideHighlight();
            } else {
                await invoke("create_overlay_window");
                this.isOverlayVisible = true;
                this.toggleOverlayBtn.textContent = "隐藏高亮层";
                this.addChatMessage("assistant", "高亮层已显示。");
            }
        } catch (error) {
            console.error("切换高亮层失败:", error);
        }
    }

    private async hideHighlight() {
        try {
            await invoke("hide_highlight");
            this.isOverlayVisible = false;
            this.toggleOverlayBtn.textContent = "显示高亮层";
        } catch (error) {
            console.error("隐藏高亮失败:", error);
        }
    }

    private async testHighlight() {
        try {
            await invoke("create_overlay_window");
            this.isOverlayVisible = true;
            this.toggleOverlayBtn.textContent = "隐藏高亮层";
            
            const testRegion: ScreenRegion = {
                x: 300,
                y: 200,
                width: 250,
                height: 80
            };
            
            await invoke("show_highlight", {
                region: testRegion,
                hint: "这是一个测试高亮 - 点击此区域"
            });
            
            this.addChatMessage("assistant", "测试高亮已显示。如果能看到红色半透明遮罩和脉冲边框，说明高亮系统工作正常。按 ESC 键可以关闭高亮。");
        } catch (error) {
            this.addChatMessage("assistant", `测试高亮失败：${error}`);
        }
    }

    private addChatMessage(role: "user" | "assistant", content: string) {
        const welcomeEl = this.chatContainer.querySelector(".chat-welcome");
        if (welcomeEl) {
            welcomeEl.remove();
        }

        const msgEl = document.createElement("div");
        msgEl.className = `chat-message ${role}`;
        
        const roleEl = document.createElement("div");
        roleEl.className = "role";
        roleEl.textContent = role === "user" ? "您" : "VOA";
        
        const contentEl = document.createElement("div");
        contentEl.className = "content";
        contentEl.innerHTML = content.replace(/\n/g, "<br>").replace(/```([\s\S]*?)```/g, '<pre style="background:#f4f4f4;padding:8px;border-radius:4px;overflow-x:auto">$1</pre>');
        
        msgEl.appendChild(roleEl);
        msgEl.appendChild(contentEl);
        this.chatContainer.appendChild(msgEl);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

        this.messages.push({ role, content });
    }

    private setStatus(status: string) {
        this.statusEl.textContent = status;
    }

    private updateWorkflowInfo() {
        this.workflowInfoEl.textContent = this.currentWorkflow?.name || "-";
    }

    private updateStepInfo() {
        if (this.currentWorkflow) {
            this.stepInfoEl.textContent = `${this.currentStep + 1} / ${this.currentWorkflow.steps.length}`;
        } else {
            this.stepInfoEl.textContent = "-";
        }
    }
}

window.addEventListener("DOMContentLoaded", () => {
    new VOAApp();
});
