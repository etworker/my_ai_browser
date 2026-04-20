import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { sendMessage, checkAIStatus, ChatMessage } from "./ai";

interface PageElement {
    tag: string;
    text: string;
    rect: { x: number; y: number; width: number; height: number };
    selector: string;
    href?: string;
    type?: string;
    placeholder?: string;
}

interface PageData {
    title: string;
    url: string;
    elements: PageElement[];
    html: string;
}

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

class VOAApp {
    private statusEl: HTMLElement;
    private chatContainer: HTMLElement;
    private userInput: HTMLTextAreaElement;
    private autoModeBtn: HTMLButtonElement;
    
    private currentPage: PageData | null = null;
    private userGoal: string = '';
    private workflowSteps: string[] = [];
    private currentStepIndex = 0;
    private isAutoMode = false;
    private isProcessing = false;

    constructor() {
        this.statusEl = document.getElementById("status")!;
        this.chatContainer = document.getElementById("chat-container")!;
        this.userInput = document.getElementById("user-input") as HTMLTextAreaElement;
        this.autoModeBtn = document.getElementById("auto-mode-btn") as HTMLButtonElement;

        this.init();
    }

    private async init() {
        document.getElementById("send-btn")?.addEventListener("click", () => this.handleSend());
        this.userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
        
        document.getElementById("open-browser-btn")?.addEventListener("click", () => this.openBrowser());
        this.autoModeBtn?.addEventListener("click", () => this.toggleAutoMode());

        this.setupEventListeners();
        await this.checkAIStatus();

        console.log("VOA 已初始化");
    }

    private setupEventListeners() {
        listen('page-analyzed', (event: any) => {
            this.currentPage = event.payload.page;
            this.onPageAnalyzed();
        });
    }

    private async onPageAnalyzed() {
        if (!this.currentPage || !this.userGoal) return;
        
        this.addChatMessage("assistant", `页面已更新: ${this.currentPage.title}\n分析元素: ${this.currentPage.elements.length}个\n\n正在思考下一步操作...`);
        
        if (this.isAutoMode) {
            await this.analyzeAndAct();
        }
    }

    private async analyzeAndAct() {
        if (this.isProcessing || !this.currentPage || !this.userGoal) return;
        this.isProcessing = true;
        this.setStatus("AI 分析中...");

        try {
            const decision = await this.getAIDecision();
            
            this.addChatMessage("assistant", `分析结果: ${decision.summary}\n操作: ${decision.reason}`);

            if (decision.action === 'done') {
                this.addChatMessage("assistant", "🎉 任务完成！");
                this.userGoal = '';
                this.isAutoMode = false;
                this.autoModeBtn.textContent = "开启自动模式";
                await invoke("set_auto_mode", { enabled: false });
            } else if (decision.action === 'click') {
                await this.executeClick(decision);
            } else if (decision.action === 'navigate') {
                await this.executeNavigate(decision);
            } else if (decision.action === 'need_vision') {
                this.addChatMessage("assistant", "需要视觉辅助判断，请手动操作或等待更新...");
            } else if (decision.action === 'wait') {
                this.addChatMessage("assistant", `等待 ${decision.wait_seconds} 秒后继续...`);
                setTimeout(() => this.analyzeAndAct(), (decision.wait_seconds || 3) * 1000);
            }
        } catch (e) {
            this.addChatMessage("assistant", `分析失败: ${e}`);
        }

        this.isProcessing = false;
        this.setStatus("就绪");
    }

    private async getAIDecision(): Promise<AIDecision> {
        if (!this.currentPage) {
            return { action: 'error', reason: '无页面数据', confidence: 0, summary: '错误' };
        }

        const prompt = this.buildAnalysisPrompt();

        try {
            const response = await sendMessage([
                { role: "system", content: "你是一个智能网页操作助手。你的任务是根据用户目标和页面信息，自主决定下一步操作。" },
                { role: "user", content: prompt }
            ]);

            return this.parseAIDecision(response.content);
        } catch (e) {
            return { action: 'error', reason: `AI 调用失败: ${e}`, confidence: 0, summary: '错误' };
        }
    }

    private buildAnalysisPrompt(): string {
        const page = this.currentPage!;
        
        let prompt = `## 用户目标\n${this.userGoal}\n\n`;
        prompt += `## 当前页面\n`;
        prompt += `- 标题: ${page.title}\n`;
        prompt += `- URL: ${page.url}\n`;
        prompt += `- 可交互元素 (${page.elements.length}个):\n\n`;

        for (const el of page.elements.slice(0, 40)) {
            const text = el.text || el.placeholder || '';
            const extra = el.href ? ` [链接: ${el.href}]` : '';
            const inputType = el.type ? ` [类型: ${el.type}]` : '';
            prompt += `- [${el.tag}${inputType}] "${text}" @ (${el.rect.x}, ${el.rect.y}) ${el.rect.width}x${el.rect.height}\n`;
            prompt += `  selector: ${el.selector}${extra}\n`;
        }

        prompt += `\n## 决策要求\n`;
        prompt += `根据用户目标，分析页面，确定下一步操作。\n\n`;
        prompt += `可能操作:\n`;
        prompt += `- click: 点击元素 (需要 target_selector)\n`;
        prompt += `- type: 输入文本 (需要 target_selector 和 input_value)\n`;
        prompt += `- navigate: 导航到 URL (需要 navigate_url)\n`;
        prompt += `- wait: 等待页面加载 (需要 wait_seconds)\n`;
        prompt += `- need_vision: 需要视觉辅助判断\n`;
        prompt += `- done: 任务完成\n\n`;
        prompt += `请以 JSON 格式返回:\n`;
        prompt += `{\n`;
        prompt += `  "action": "操作类型",\n`;
        prompt += `  "reason": "决策理由",\n`;
        prompt += `  "confidence": 0.0-1.0,\n`;
        prompt += `  "summary": "简短总结",\n`;
        prompt += `  "target_selector": "CSS选择器(仅click/type)",\n`;
        prompt += `  "target_text": "目标文字(可选)",\n`;
        prompt += `  "input_value": "输入内容(仅type)",\n`;
        prompt += `  "navigate_url": "URL(仅navigate)",\n`;
        prompt += `  "wait_seconds": 秒数(仅wait)\n`;
        prompt += `}\n\n`;
        prompt += `直接返回 JSON，不要其他内容。`;

        return prompt;
    }

    private parseAIDecision(content: string): AIDecision {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const data = JSON.parse(jsonMatch[0]);
                return {
                    action: data.action || 'error',
                    target_selector: data.target_selector,
                    target_text: data.target_text,
                    input_value: data.input_value,
                    navigate_url: data.navigate_url,
                    wait_seconds: data.wait_seconds,
                    reason: data.reason || '',
                    confidence: data.confidence || 0.5,
                    summary: data.summary || ''
                };
            }
        } catch (e) {
            console.error('解析 AI 决策失败:', e);
        }
        return { action: 'error', reason: '解析失败', confidence: 0, summary: '错误' };
    }

    private async executeClick(decision: AIDecision) {
        if (!decision.target_selector) return;

        this.addChatMessage("assistant", `执行点击: ${decision.target_text || decision.target_selector}`);

        if (this.isAutoMode) {
            try {
                const result = await invoke("execute_browser_action", {
                    action: JSON.stringify({
                        type: 'click',
                        selector: decision.target_selector
                    })
                });
                
                setTimeout(() => this.analyzeAndAct(), 2000);
            } catch (e) {
                this.addChatMessage("assistant", `点击执行失败: ${e}`);
            }
        } else {
            this.addChatMessage("assistant", `请手动点击 "${decision.target_text || decision.target_selector}"，完成后告诉我"继续"`);
        }
    }

    private async executeNavigate(decision: AIDecision) {
        if (!decision.navigate_url) return;

        this.addChatMessage("assistant", `导航到: ${decision.navigate_url}`);

        if (this.isAutoMode) {
            try {
                await invoke("execute_browser_action", {
                    action: JSON.stringify({
                        type: 'navigate',
                        url: decision.navigate_url
                    })
                });
                
                setTimeout(() => this.analyzeAndAct(), 3000);
            } catch (e) {
                this.addChatMessage("assistant", `导航失败: ${e}`);
            }
        }
    }

    private async handleSend() {
        const input = this.userInput.value.trim();
        if (!input) return;

        this.addChatMessage("user", input);
        this.userInput.value = "";

        await this.processUserInput(input);
    }

    private async processUserInput(input: string) {
        const lower = input.toLowerCase();

        if (lower.includes("打开") || lower.includes("浏览器")) {
            return this.openBrowser();
        }

        if (lower.includes("自动") && (lower.includes("模式") || lower.includes("开始"))) {
            return this.startAutoMode();
        }

        if (lower.includes("继续") || lower.includes("下一步")) {
            if (this.isAutoMode) {
                return this.analyzeAndAct();
            } else {
                return this.addChatMessage("assistant", "请先开启自动模式，或告诉我您想完成的任务。");
            }
        }

        if (lower.includes("停止") || lower.includes("退出")) {
            this.isAutoMode = false;
            this.userGoal = '';
            this.autoModeBtn.textContent = "开启自动模式";
            await invoke("set_auto_mode", { enabled: false });
            return this.addChatMessage("assistant", "已退出自动模式。");
        }

        this.userGoal = input;
        this.addChatMessage("assistant", 
            `好的，我已经理解您的目标: "${input}"\n\n` +
            `请确保浏览器已打开并访问目标网站，然后：\n` +
            `1. 点击"开启自动模式"按钮\n` +
            `2. 我将自动分析页面并指导您操作\n\n` +
            `或者点击"继续"让我分析当前页面。`
        );
    }

    private async startAutoMode() {
        if (!this.currentPage) {
            this.addChatMessage("assistant", "请先在浏览器中打开目标网页。");
            return;
        }

        if (!this.userGoal) {
            this.addChatMessage("assistant", "请先告诉我您想完成什么任务。");
            return;
        }

        this.isAutoMode = true;
        this.autoModeBtn.textContent = "停止自动模式";
        this.autoModeBtn.classList.add('active');
        
        await invoke("set_auto_mode", { enabled: true });
        
        this.addChatMessage("assistant", 
            `🚀 自动模式已开启！\n\n` +
            `目标: ${this.userGoal}\n` +
            `当前页面: ${this.currentPage.title}\n\n` +
            `我将自动分析页面并指导您下一步操作...`
        );

        await this.analyzeAndAct();
    }

    private async toggleAutoMode() {
        if (this.isAutoMode) {
            this.isAutoMode = false;
            this.autoModeBtn.textContent = "开启自动模式";
            this.autoModeBtn.classList.remove('active');
            await invoke("set_auto_mode", { enabled: false });
            this.addChatMessage("assistant", "自动模式已关闭。");
        } else {
            await this.startAutoMode();
        }
    }

    private async openBrowser() {
        try {
            await invoke("open_browser_window");
            this.addChatMessage("assistant", "浏览器已打开。请在浏览器中访问您想操作的网站，然后告诉我您的目标。");
        } catch (e) {
            this.addChatMessage("assistant", `打开浏览器失败: ${e}`);
        }
    }

    private async checkAIStatus() {
        try {
            const status = await checkAIStatus();
            if (status.available) {
                this.addChatMessage("assistant", 
                    `VOA 智能助手已就绪！\n\n` +
                    `AI 模型: ${status.model}\n\n` +
                    `使用方法:\n` +
                    `1. 点击"打开浏览器"访问目标网站\n` +
                    `2. 告诉我您想完成的任务\n` +
                    `3. 点击"开启自动模式"\n\n` +
                    `AI 将自动分析页面、定位元素、指导操作！`
                );
            } else {
                this.addChatMessage("assistant", 
                    `AI 未就绪。请启动 Ollama:\n` +
                    `\`\`\`bash\nollama serve\nollama pull gemma4:e2b\n\`\`\``
                );
            }
        } catch (e) {
            console.warn("AI 状态检查失败:", e);
        }
    }

    private addChatMessage(role: "user" | "assistant", content: string) {
        const welcomeEl = this.chatContainer.querySelector(".chat-welcome");
        if (welcomeEl) welcomeEl.remove();

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
    }

    private setStatus(status: string) {
        this.statusEl.textContent = status;
    }
}

window.addEventListener("DOMContentLoaded", () => {
    new VOAApp();
});
