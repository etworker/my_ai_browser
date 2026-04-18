export interface ScreenCapture {
    screenshot: string;
    url: string;
    timestamp: number;
}

export interface DOMData {
    title: string;
    url: string;
    interactive_elements: InteractiveElement[];
}

export interface InteractiveElement {
    tag: string;
    text: string;
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    selector: string;
}

export interface AnalysisResult {
    summary: string;
    current_step: number;
    next_action: string;
    target_element?: InteractiveElement;
    confidence: number;
}

class VisionModule {
    private screenshot: ScreenCapture | null = null;
    private domData: DOMData | null = null;

    setScreenshot(screenshot: ScreenCapture) {
        this.screenshot = screenshot;
    }

    setDOM(domData: DOMData) {
        this.domData = domData;
    }

    clear() {
        this.screenshot = null;
        this.domData = null;
    }

    hasContent(): boolean {
        return this.screenshot !== null || this.domData !== null;
    }

    getContext(): {
        hasScreenshot: boolean;
        hasDOM: boolean;
        pageTitle: string;
        pageURL: string;
        elementCount: number;
    } {
        return {
            hasScreenshot: this.screenshot !== null,
            hasDOM: this.domData !== null,
            pageTitle: this.domData?.title || '',
            pageURL: this.domData?.url || '',
            elementCount: this.domData?.interactive_elements?.length || 0
        };
    }

    generatePromptForStep(stepDescription: string): string {
        let prompt = `用户想要完成以下操作: "${stepDescription}"\n\n`;

        if (this.domData) {
            prompt += `当前页面信息:\n`;
            prompt += `- 标题: ${this.domData.title}\n`;
            prompt += `- URL: ${this.domData.url}\n`;
            prompt += `- 可交互元素 (${this.domData.interactive_elements.length}个):\n\n`;

            for (const el of this.domData.interactive_elements.slice(0, 20)) {
                const textPreview = el.text ? `"${el.text.slice(0, 50)}"` : '(无文字)';
                prompt += `- [${el.tag}] ${textPreview} @ (${el.rect.x}, ${el.rect.y}) ${el.rect.width}x${el.rect.height}\n`;
                prompt += `  selector: ${el.selector}\n`;
            }

            if (this.domData.interactive_elements.length > 20) {
                prompt += `\n(...还有 ${this.domData.interactive_elements.length - 20} 个元素)\n`;
            }
        }

        prompt += `\n基于以上信息:\n`;
        prompt += `1. 分析当前页面状态\n`;
        prompt += `2. 确定最可能的目标元素\n`;
        prompt += `3. 用 JSON 格式返回:\n`;
        prompt += `{\n`;
        prompt += `  "summary": "页面摘要（10字内）",\n`;
        prompt += `  "next_action": "下一步操作描述",\n`;
        prompt += `  "target_selector": "CSS选择器或空字符串",\n`;
        prompt += `  "target_text": "目标元素的文字或空字符串",\n`;
        prompt += `  "confidence": 0.0-1.0\n`;
        prompt += `}`;

        return prompt;
    }

    parseAnalysisResponse(response: string): AnalysisResult | null {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const data = JSON.parse(jsonMatch[0]);
                
                let target_element: InteractiveElement | undefined;
                if (data.target_selector && this.domData) {
                    target_element = this.domData.interactive_elements.find(
                        el => el.selector === data.target_selector || 
                              el.text === data.target_text
                    );
                }

                return {
                    summary: data.summary || '',
                    current_step: data.current_step || 0,
                    next_action: data.next_action || '',
                    target_element,
                    confidence: data.confidence || 0
                };
            }
        } catch (e) {
            console.error('解析分析结果失败:', e);
        }
        return null;
    }
}

export const visionModule = new VisionModule();

export function analyzeScreen(stepDescription: string): string {
    return visionModule.generatePromptForStep(stepDescription);
}

export function parseAIResponse(response: string): AnalysisResult | null {
    return visionModule.parseAnalysisResponse(response);
}

export function getScreenContext() {
    return visionModule.getContext();
}
