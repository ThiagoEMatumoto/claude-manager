// Integrações que o app sabe usar. A UI (Configurações → Variáveis de ambiente)
// renderiza esta lista com status configurada/não configurada; o main lê o valor
// via getEnvVar(envKey). É só uma lista — não há registro dinâmico.

export interface KnownEnvVar {
  envKey: string
  label: string
  unlocks: string
  docsUrl: string
}

export const KNOWN_ENV_VARS: KnownEnvVar[] = [
  {
    envKey: 'TAVILY_API_KEY',
    label: 'Tavily',
    unlocks: 'Busca web dos Dossiês',
    docsUrl: 'https://tavily.com',
  },
]
