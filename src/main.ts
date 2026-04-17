import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
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
    
    private isOverlayVisible = false;
    private messages: ChatMessage[] = [];
    private currentWorkflow: any = null;
    private currentStep = 0;

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

        this.init();
    }

    private init() {
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

        console.log("VOA 应用已初始化");
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
            this.currentStep = 0;
            this.updateWorkflowInfo();
            this.updateStepInfo();
            
            return `好的，我将帮助您完成"${this.currentWorkflow.name}"。\n\n当前步骤 (1/${this.currentWorkflow.steps.length})：\n${this.currentWorkflow.steps[0].hint}\n\n请按照屏幕上的高亮提示进行操作，完成后告诉我"下一步"或"完成了"。`;
        }

        if (lower.includes("下一步") || lower.includes("继续") || lower.includes("完成了")) {
            if (!this.currentWorkflow) {
                return "您还没有选择任何工作流。请先告诉我您想做什么。";
            }
            
            this.currentStep++;
            
            if (this.currentStep >= this.currentWorkflow.steps.length) {
                this.addChatMessage("assistant", `🎉 恭喜！您已完成"${this.currentWorkflow.name}"！`);
                this.currentWorkflow = null;
                this.currentStep = 0;
                this.updateWorkflowInfo();
                this.updateStepInfo();
                await this.hideHighlight();
                return "工作流已完成！如果需要帮助其他操作，请告诉我。";
            }
            
            this.updateStepInfo();
            const step = this.currentWorkflow.steps[this.currentStep];
            
            await this.showHighlightForStep(step);
            
            return `下一步 (${this.currentStep + 1}/${this.currentWorkflow.steps.length})：\n${step.hint}`;
        }

        if (lower.includes("上一步") || lower.includes("返回")) {
            if (!this.currentWorkflow || this.currentStep === 0) {
                return "无法返回上一步。";
            }
            
            this.currentStep--;
            this.updateStepInfo();
            const step = this.currentWorkflow.steps[this.currentStep];
            
            await this.showHighlightForStep(step);
            
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

        return `我理解您想做"${input}"。\n\n抱歉，当前的原型版本主要支持 AWS EC2 启动流程。\n\n请尝试说："我想在 AWS 上启动一台 EC2"`;
    }

    private async showHighlightForStep(step: any) {
        try {
            await invoke("create_overlay_window");
            this.isOverlayVisible = true;
            this.toggleOverlayBtn.textContent = "隐藏高亮层";
            
            const testRegion: ScreenRegion = {
                x: 200 + Math.random() * 400,
                y: 150 + Math.random() * 200,
                width: 200,
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
            
            this.setStatus("就绪");
            this.addChatMessage("assistant", `屏幕捕获成功！分辨率: ${result.width}x${result.height}。您可以将此截图发送给 AI 进行分析。`);
        } catch (error) {
            this.setStatus("错误");
            this.addChatMessage("assistant", `屏幕捕获失败：${error}`);
        }
    }

    private async handleCalibrate() {
        this.addChatMessage("assistant", "校准功能正在开发中...\n\n校准功能将允许您点击屏幕上的已知元素，以建立 OCR 坐标到屏幕坐标的映射。");
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
            
            this.addChatMessage("assistant", "测试高亮已显示在屏幕中央。如果能看到红色半透明遮罩和脉冲边框，说明高亮系统工作正常。");
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
        contentEl.innerHTML = content.replace(/\n/g, "<br>");
        
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
