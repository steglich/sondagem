export const ARQUIVO_SCHEMA: string;
export const ARQUIVO_VALIDADOR: string;
export function gerarValidador(): Promise<string>;
export function gravarValidador(): Promise<void>;
