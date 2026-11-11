/** Erro bruto do validador gerado (formato do Ajv). */
export interface ErroBruto {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

interface Validador {
  (dado: unknown): boolean;
  errors?: ErroBruto[] | null;
}

declare const validar: Validador;
export default validar;
export { validar as validate };
