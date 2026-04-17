import { invoke } from "@tauri-apps/api/core";
import { extractScreenText, findTextRegion, OCRResult } from "./ocr";
import { checkAIStatus, classifyUserIntent, sendMessage, ChatMessage } from "./ai";
import { loadCalibration, applyCalibration } from "./calibration";

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

class VOAApp {
    private statusEl: HTMLElement;
    private workflowInfoEl: HTMLElement;
    private stepInfoEl: HTMLElement;
    private chatContainer: HTMLElement;
    private userInput: HTMLTextAreaElement;
    private sendBtn: HTMLButtonElement;
    private captureBtn: HTMLButtonElement;
    private calibrateBtn: HTMLButtonElement;
    private toggleOverlayBtn: HTMLButtonElement;
    private testHighlightBtn: HTMLButtonElement;
    private ocrBtn: HTMLButtonElement;
    
    private isOverlayVisible = false;
    private messages: ChatMessage[] = [];
    private currentWorkflow: Workflow | null = null;
    private currentStep = 0;
    private lastOCRResult: OCRResult | null = null;
    private currentPlatform = 'generic';

    constructor() {
        this.statusEl = document.getElementById("status")!;
        this.workflowInfoEl = document.getElementById("workflow-info")!;
        this.stepInfoEl = document.getElementById("step-info")!;
        this.chatContainer = document.getElementById("chat-container")!;
        this.userInput = document.getElementById("user-input") as HTMLTextAreaElement;
        this.sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
        this.captureBtn = document.getElementById("capture-btn") as HTMLButtonElement;
        this.calibrateBtn = document.getElementById("calibrate-btn") as HTMLButtonElement;
        this.toggleOverlayBtn = document.getElementById("toggle-overlay-btn") as HTMLButtonElement;
        this.testHighlightBtn = document.getElementById("test-highlight-btn") as HTMLButtonElement;
        this.ocrBtn = document.getElementById("ocr-btn") as HTMLButtonElement;

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
        
        this.captureBtn.addEventListener("click", () => this.handleCapture());
        this.calibrateBtn.addEventListener("click", () => this.handleCalibrate());
        this.toggleOverlayBtn.addEventListener("click", () => this.toggleOverlay());
        this.testHighlightBtn.addEventListener("click", () => this.testHighlight());
        this.ocrBtn?.addEventListener("click", () => this.handleOCR());

        await this.checkAIStatus();
        await this.loadPlatformCalibration();

        console.log("VOA 应用已初始化");
    }

    private async checkAIStatus() {
        try {
            const status = await checkAIStatus();
            if (status.available) {
                this.addChatMessage("assistant", `AI 引擎已就绪 (${status.model})。您可以描述您想完成的操作，我会指导您一步步完成。`);
            } else {
                this.addChatMessage("assistant", `本地 AI 引擎未启动。请确保 Ollama 正在运行:\n\`\`\`bash\nollama serve\n\`\`\`\n\n或者配置云端 AI API key。`);
            }
        } catch (e) {
            console.warn("AI 状态检查失败:", e);
        }
    }

    private async loadPlatformCalibration() {
        try {
            const calibration = await loadCalibration(this.currentPlatform);
            if (calibration) {
                console.log("已加载校准数据");
            }
        } catch (e) {
            console.warn("加载校准数据失败:", e);
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

        if (lower.includes("aws") || lower.includes("ec2") || lower.includes("启动") || lower.includes("创建")) {
            this.currentWorkflow = {
                name: "AWS EC2 启动流程",
                platform: "aws",
                steps: [
                    { action: "点击", target: "服务搜索框", hint: "在 AWS 控制台顶部搜索框中输入 'EC2'", expectedText: "服务" },
                    { action: "点击", target: "EC2 选项", hint: "点击搜索结果中的 'EC2'", expectedText: "EC2" },
                    { action: "点击", target: "启动实例按钮", hint: "点击 '启动实例' 按钮", expectedText: "启动实例" },
                    { action: "选择", target: "AMI", hint: "选择一个 Amazon Machine Image (AMI)", expectedText: "AMI" },
                    { action: "选择", target: "实例类型", hint: "选择实例类型（如 t2.micro）", expectedText: "实例类型" },
                    { action: "配置", target: "实例详情", hint: "配置实例详情", expectedText: "实例详情" },
                    { action: "添加", target: "存储", hint: "添加存储卷", expectedText: "存储" },
                    { action: "配置", target: "安全组", hint: "配置安全组规则", expectedText: "安全组" },
                    { action: "审核", target: "启动审核", hint: "审核配置并点击 '启动'", expectedText: "审核" },
                    { action: "选择", target: "密钥对", hint: "选择或创建密钥对，然后点击 '启动实例'", expectedText: "密钥对" }
                ]
            };
            this.currentPlatform = 'aws';
            this.currentStep = 0;
            this.updateWorkflowInfo();
            this.updateStepInfo();
            
            return `好的，我将帮助您完成"${this.currentWorkflow.name}"。\n\n当前步骤 (1/${this.currentWorkflow.steps.length})：\n${this.currentWorkflow.steps[0].hint}\n\n请先捕获屏幕（点击"捕获屏幕"按钮），然后告诉我"下一步"。`;
        }

        if (lower.includes("下一步") || lower.includes("继续") || lower.includes("ocr") || lower.includes("识别")) {
            if (!this.currentWorkflow) {
                return "您还没有选择任何工作流。请先告诉我您想做什么。";
            }
            
            if (this.lastOCRResult) {
                const step = this.currentWorkflow.steps[this.currentStep];
                const region = findTextRegion(this.lastOCRResult, step.expectedText || step.target);
                
                if (region) {
                    const screenRegion = applyCalibration(region);
                    await this.showHighlightForRegion(screenRegion, step.hint);
                    this.addChatMessage("assistant", `已在屏幕上高亮 "${step.expectedText || step.target}"。`);
                }
            }
            
            this.currentStep++;
            
            if (this.currentStep >= this.currentWorkflow.steps.length) {
                this.currentWorkflow = null;
                this.currentStep = 0;
                this.updateWorkflowInfo();
                this.updateStepInfo();
                await this.hideHighlight();
                return "恭喜！您已完成整个工作流！";
            }
            
            this.updateStepInfo();
            const step = this.currentWorkflow.steps[this.currentStep];
            
            return `下一步 (${this.currentStep + 1}/${this.currentWorkflow.steps.length})：\n${step.hint}\n\n请先捕获屏幕，然后告诉我"下一步"来定位目标元素。`;
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
                await this.hideHighlight();
                return "已退出当前工作流。";
            }
            return "当前没有正在执行的工作流。";
        }

        try {
            const intent = await classifyUserIntent(input);
            return `我理解您想: ${intent.intent}\n\n置信度: ${(intent.confidence * 100).toFixed(0)}%\n推理: ${intent.reasoning || '无'}\n\n请告诉我更具体的操作，比如："我想在 AWS 上启动 EC2"`;
        } catch (e) {
            return `我理解您想做"${input}"。\n\n请告诉我更具体的操作，或者直接说"我想在 AWS 上启动 EC2"`;
        }
    }

    private async showHighlightForRegion(region: ScreenRegion, hint: string) {
        try {
            await invoke("create_overlay_window");
            this.isOverlayVisible = true;
            this.toggleOverlayBtn.textContent = "隐藏高亮层";
            
            await invoke("show_highlight", {
                region,
                hint
            });
        } catch (error) {
            console.error("显示高亮失败:", error);
        }
    }

    private async showHighlightForStep(step: WorkflowStep) {
        try {
            await invoke("create_overlay_window");
            this.isOverlayVisible = true;
            this.toggleOverlayBtn.textContent = "隐藏高亮层";
            
            const testRegion: ScreenRegion = {
                x: 300 + Math.random() * 200,
                y: 200 + Math.random() * 100,
                width: 250,
                height: 60
            };
            
            await invoke("show_highlight", {
                region: testRegion,
                hint: step.hint
            });
        } catch (error) {
            console.error("显示高亮失败:", error);
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
            
            this.setStatus("识别文字中...");
            
            try {
                this.lastOCRResult = await extractScreenText(result.image_base64);
                this.addChatMessage("assistant", 
                    `屏幕捕获成功！\n` +
                    `分辨率: ${result.width}x${result.height}\n` +
                    `识别文字 ${this.lastOCRResult.regions.length} 个区域\n` +
                    `置信度: ${this.lastOCRResult.confidence.toFixed(1)}%\n\n` +
                    `现在可以告诉我"下一步"来定位目标元素。`
                );
            } catch (ocrError) {
                this.addChatMessage("assistant", 
                    `屏幕捕获成功！但 OCR 识别失败: ${ocrError}\n\n您可以尝试说"下一步"继续工作流。`
                );
            }
            
            this.setStatus("就绪");
        } catch (error) {
            this.setStatus("错误");
            this.addChatMessage("assistant", `屏幕捕获失败：${error}`);
        }
    }

    private async handleOCR() {
        this.setStatus("OCR 识别中...");
        
        try {
            const result = await invoke<CaptureResult>("capture_screen");
            this.lastOCRResult = await extractScreenText(result.image_base64);
            
            const textPreview = this.lastOCRResult.text.slice(0, 500);
            const regionCount = this.lastOCRResult.regions.length;
            
            this.addChatMessage("assistant", 
                `OCR 识别完成！\n\n` +
                `识别区域: ${regionCount} 个\n` +
                `置信度: ${this.lastOCRResult.confidence.toFixed(1)}%\n\n` +
                `识别文字预览:\n${textPreview}...`
            );
            
            this.setStatus("就绪");
        } catch (error) {
            this.setStatus("错误");
            this.addChatMessage("assistant", `OCR 识别失败：${error}`);
        }
    }

    private async handleCalibrate() {
        this.addChatMessage("assistant", 
            `校准功能说明:\n\n` +
            `校准用于提高 OCR 坐标到屏幕坐标的转换精度。\n\n` +
            `使用方法:\n` +
            `1. 在目标网站（如 AWS 控制台）上\n` +
            `2. 点击一个您知道位置的元素（如"服务"文字）\n` +
            `3. 在聊天框中输入: 校准 [元素名称] x=100 y=200\n` +
            `4. 重复 3 次不同元素\n` +
            `5. 系统会自动计算坐标变换矩阵\n\n` +
            `示例: "校准 服务 x=150 y=45"`);
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
            await invoke("close_overlay_window");
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
