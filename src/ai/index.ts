export interface AIResponse {
    content: string;
    confidence: number;
    source: 'local' | 'cloud';
    modelUsed: string;
}

export interface IntentResult {
    intent: string;
    confidence: number;
    entities: Record<string, string>;
    reasoning?: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface AIEngine {
    complete(messages: ChatMessage[]): Promise<AIResponse>;
    classifyIntent(text: string): Promise<IntentResult>;
    isAvailable(): Promise<boolean>;
    getModelName(): string;
}

export interface AIConfig {
    provider: 'ollama' | 'openai' | 'anthropic';
    endpoint?: string;
    apiKey?: string;
    model: string;
    fallbackThreshold: number;
}

const DEFAULT_CONFIG: AIConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'gemma4:e2b',
    fallbackThreshold: 0.6
};

class OllamaEngine implements AIEngine {
    private endpoint: string;
    private model: string;

    constructor(endpoint: string, model: string) {
        this.endpoint = endpoint;
        this.model = model;
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.endpoint}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    getModelName(): string {
        return this.model;
    }

    async complete(messages: ChatMessage[]): Promise<AIResponse> {
        const response = await fetch(`${this.endpoint}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API 错误: ${response.status}`);
        }

        const data = await response.json();
        
        return {
            content: data.message?.content || '',
            confidence: 0.8,
            source: 'local',
            modelUsed: this.model
        };
    }

    async classifyIntent(text: string): Promise<IntentResult> {
        const prompt = `你是一个意图分类器。根据用户输入，分类意图并提取实体。

用户输入: "${text}"

请以 JSON 格式返回：
{
    "intent": "意图名称",
    "confidence": 0.0-1.0,
    "entities": {"key": "value"},
    "reasoning": "简短推理"
}

常见意图:
- launch_ec2: 启动 AWS EC2 实例
- create_s3_bucket: 创建 S3 存储桶
- create_github_repo: 创建 GitHub 仓库
- navigate: 导航到某个页面
- unknown: 无法分类

只返回 JSON，不要其他内容。`;

        const response = await this.complete([
            { role: 'user', content: prompt }
        ]);

        try {
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('解析意图结果失败:', e);
        }

        return {
            intent: 'unknown',
            confidence: 0,
            entities: {},
            reasoning: '无法解析 AI 返回结果'
        };
    }
}

class OpenAIEngine implements AIEngine {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string = 'gpt-4o-mini') {
        this.apiKey = apiKey;
        this.model = model;
    }

    async isAvailable(): Promise<boolean> {
        return this.apiKey.length > 0;
    }

    getModelName(): string {
        return this.model;
    }

    async complete(messages: ChatMessage[]): Promise<AIResponse> {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API 错误: ${response.status}`);
        }

        const data = await response.json();
        
        return {
            content: data.choices?.[0]?.message?.content || '',
            confidence: 0.9,
            source: 'cloud',
            modelUsed: this.model
        };
    }

    async classifyIntent(text: string): Promise<IntentResult> {
        const prompt = `你是一个意图分类器。根据用户输入，分类意图并提取实体。

用户输入: "${text}"

请以 JSON 格式返回：
{
    "intent": "意图名称",
    "confidence": 0.0-1.0,
    "entities": {"key": "value"},
    "reasoning": "简短推理"
}

只返回 JSON，不要其他内容。`;

        const response = await this.complete([
            { role: 'user', content: prompt }
        ]);

        try {
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('解析意图结果失败:', e);
        }

        return {
            intent: 'unknown',
            confidence: 0,
            entities: {},
            reasoning: '无法解析 AI 返回结果'
        };
    }
}

class HybridAIEngine implements AIEngine {
    private localEngine: OllamaEngine | null = null;
    private cloudEngine: OpenAIEngine | null = null;
    private fallbackThreshold: number;
    private useCloud: boolean = false;

    constructor(config: AIConfig) {
        if (config.provider === 'ollama') {
            this.localEngine = new OllamaEngine(
                config.endpoint || 'http://localhost:11434',
                config.model
            );
        }
        
        if (config.apiKey) {
            this.cloudEngine = new OpenAIEngine(config.apiKey);
        }
        
        this.fallbackThreshold = config.fallbackThreshold;
    }

    async isAvailable(): Promise<boolean> {
        if (this.localEngine) {
            const localAvailable = await this.localEngine.isAvailable();
            if (localAvailable) {
                return true;
            }
        }
        
        if (this.cloudEngine) {
            return await this.cloudEngine.isAvailable();
        }
        
        return false;
    }

    getModelName(): string {
        return this.useCloud 
            ? (this.cloudEngine?.getModelName() || 'unknown')
            : (this.localEngine?.getModelName() || 'unknown');
    }

    async complete(messages: ChatMessage[]): Promise<AIResponse> {
        if (this.localEngine && !this.useCloud) {
            try {
                const response = await this.localEngine.complete(messages);
                if (response.confidence >= this.fallbackThreshold) {
                    return response;
                }
            } catch (e) {
                console.warn('本地 AI 失败，尝试云端:', e);
                this.useCloud = true;
            }
        }
        
        if (this.cloudEngine) {
            return this.cloudEngine.complete(messages);
        }
        
        throw new Error('没有可用的 AI 引擎');
    }

    async classifyIntent(text: string): Promise<IntentResult> {
        if (this.localEngine && !this.useCloud) {
            try {
                const result = await this.localEngine.classifyIntent(text);
                if (result.confidence >= this.fallbackThreshold) {
                    return result;
                }
            } catch (e) {
                console.warn('本地意图分类失败:', e);
                this.useCloud = true;
            }
        }
        
        if (this.cloudEngine) {
            return this.cloudEngine.classifyIntent(text);
        }
        
        return {
            intent: 'unknown',
            confidence: 0,
            entities: {},
            reasoning: '没有可用的 AI 引擎'
        };
    }
}

let aiEngine: HybridAIEngine | null = null;

export function initializeAIEngine(config: Partial<AIConfig> = {}): HybridAIEngine {
    const fullConfig: AIConfig = {
        ...DEFAULT_CONFIG,
        ...config
    };
    
    aiEngine = new HybridAIEngine(fullConfig);
    return aiEngine;
}

export function getAIEngine(): HybridAIEngine {
    if (!aiEngine) {
        aiEngine = initializeAIEngine();
    }
    return aiEngine;
}

export async function sendMessage(messages: ChatMessage[]): Promise<AIResponse> {
    const engine = getAIEngine();
    return engine.complete(messages);
}

export async function classifyUserIntent(text: string): Promise<IntentResult> {
    const engine = getAIEngine();
    return engine.classifyIntent(text);
}

export async function checkAIStatus(): Promise<{available: boolean, model: string}> {
    const engine = getAIEngine();
    const available = await engine.isAvailable();
    return {
        available,
        model: engine.getModelName()
    };
}
