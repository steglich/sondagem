/**
 * Wrapper pequeno do debugger do Chrome (CDP), reutilizado pelas fases seguintes.
 *
 * Tudo o que toca `chrome.debugger` chega por `TransporteCdp`; os testes usam um
 * transporte falso. Uma conexão vale para uma aba e uma análise: anexa depois da
 * confirmação e desanexa sempre ao término (`desanexar` é idempotente).
 */
import type { CategoriaFalhaAnexacao, MotivoDesconexao } from '../shared/types.ts';

export const VERSAO_PROTOCOLO = '1.3';

/** O que este módulo usa de `chrome.debugger`. */
export interface TransporteCdp {
  /**
   * `true` se a aba já tem um cliente de depuração (DevTools, outra extensão,
   * automação). O Chrome não diz qual. Consultado antes de anexar.
   */
  alvoJaDepurado(idAba: number): Promise<boolean>;
  anexar(idAba: number, versao: string): Promise<void>;
  desanexar(idAba: number): Promise<void>;
  enviar(idAba: number, metodo: string, parametros?: object): Promise<unknown>;
  /** Assina os eventos de CDP de todas as abas. Devolve a função que cancela a assinatura. */
  aoEvento(ouvinte: (idAba: number, metodo: string, parametros: unknown) => void): () => void;
  /** Assina as desanexações feitas por fora (não as pedidas por `desanexar`). */
  aoDesanexar(ouvinte: (idAba: number, motivo: MotivoDesconexao) => void): () => void;
}

export class FalhaAnexacao extends Error {
  constructor(
    readonly categoria: CategoriaFalhaAnexacao,
    /** Mensagem original do Chrome. */
    readonly original: string,
  ) {
    super(original);
    this.name = 'FalhaAnexacao';
  }
}

/** A conexão caiu (ou nunca existiu) e o comando não pôde ser enviado. */
export class ConexaoPerdida extends Error {
  constructor(readonly motivo: MotivoDesconexao) {
    super(`Conexão com o debugger perdida: ${motivo}`);
    this.name = 'ConexaoPerdida';
  }
}

const OUTRO_DEPURADOR = /another debugger is already attached/i;
/** Páginas internas, de outras extensões, a loja, ou uma aba que não existe mais. */
const NAO_DEPURAVEL = /cannot access|cannot be scripted|cannot attach to (this|the) target|no tab with (given )?id|not allowed/i;

/**
 * Categoria de uma falha de `chrome.debugger.attach`, pelos textos observados no
 * Chrome 158 (ver Open Questions do design da fase 2). Texto fora desses padrões é
 * "desconhecido", com a mensagem original preservada.
 */
export function classificarFalhaAnexacao(mensagem: string): CategoriaFalhaAnexacao {
  if (OUTRO_DEPURADOR.test(mensagem)) return 'outro-depurador';
  if (NAO_DEPURAVEL.test(mensagem)) return 'alvo-nao-depuravel';
  return 'desconhecido';
}

export interface ConexaoCdp {
  /** Anexa o debugger à aba. Lança `FalhaAnexacao` se não for possível. */
  anexar(idAba: number): Promise<void>;
  enviar<T = unknown>(metodo: string, parametros?: object): Promise<T>;
  /** Assina um evento de CDP da aba anexada. Devolve a função que cancela a assinatura. */
  aoEvento(metodo: string, ouvinte: (parametros: unknown) => void): () => void;
  /** Avisa quando a conexão é desfeita por fora: barra de depuração, aba fechada, outro depurador. */
  aoPerder(ouvinte: (motivo: MotivoDesconexao) => void): void;
  /**
   * Desfaz a conexão e solta todos os ouvintes. Pode ser chamada várias vezes e
   * sem ter anexado. Devolve `true` se o debugger estava anexado e foi desanexado agora.
   */
  desanexar(): Promise<boolean>;
  readonly anexada: boolean;
}

export function criarConexaoCdp(transporte: TransporteCdp): ConexaoCdp {
  let idAba: number | null = null;
  let anexada = false;
  let perdida: MotivoDesconexao | null = null;
  const ouvintes = new Map<string, Set<(parametros: unknown) => void>>();
  const aoPerder: ((motivo: MotivoDesconexao) => void)[] = [];
  let cancelarAssinaturas: (() => void)[] = [];

  function soltar(): void {
    cancelarAssinaturas.forEach((cancelar) => cancelar());
    cancelarAssinaturas = [];
    ouvintes.clear();
  }

  return {
    get anexada() {
      return anexada;
    },

    async anexar(aba) {
      if (anexada) throw new Error('A conexão já está anexada a uma aba.');
      let jaDepurado: boolean;
      try {
        jaDepurado = await transporte.alvoJaDepurado(aba);
      } catch {
        // Sem a consulta prévia, a própria anexação decide.
        jaDepurado = false;
      }
      // Nunca disputa a aba com outro depurador nem tenta substituí-lo.
      if (jaDepurado) throw new FalhaAnexacao('outro-depurador', 'A aba já tem um depurador anexado.');

      try {
        await transporte.anexar(aba, VERSAO_PROTOCOLO);
      } catch (erro) {
        const original = erro instanceof Error ? erro.message : String(erro);
        throw new FalhaAnexacao(classificarFalhaAnexacao(original), original);
      }
      idAba = aba;
      anexada = true;
      perdida = null;
      cancelarAssinaturas = [
        transporte.aoEvento((origem, metodo, parametros) => {
          if (origem !== idAba) return;
          ouvintes.get(metodo)?.forEach((ouvinte) => ouvinte(parametros));
        }),
        transporte.aoDesanexar((origem, motivo) => {
          if (origem !== idAba || !anexada) return;
          anexada = false;
          perdida = motivo;
          soltar();
          aoPerder.forEach((ouvinte) => ouvinte(motivo));
        }),
      ];
    },

    async enviar<T>(metodo: string, parametros?: object): Promise<T> {
      if (!anexada || idAba === null) throw new ConexaoPerdida(perdida ?? 'nao-anexada');
      return (await transporte.enviar(idAba, metodo, parametros)) as T;
    },

    aoEvento(metodo, ouvinte) {
      let conjunto = ouvintes.get(metodo);
      if (!conjunto) ouvintes.set(metodo, (conjunto = new Set()));
      conjunto.add(ouvinte);
      return () => void conjunto.delete(ouvinte);
    },

    aoPerder(ouvinte) {
      aoPerder.push(ouvinte);
    },

    async desanexar() {
      const estavaAnexada = anexada;
      anexada = false;
      soltar();
      aoPerder.length = 0;
      if (idAba === null) return false;
      if (!estavaAnexada) {
        // Depois de uma desanexação externa o navegador já soltou a aba; a tentativa
        // só garante que nada fica anexado se o aviso tiver vindo sem a desanexação.
        if (perdida !== null) await transporte.desanexar(idAba).catch(() => undefined);
        perdida = null;
        return false;
      }
      try {
        // Desanexar desfaz no navegador os domínios habilitados e as emulações desta conexão.
        await transporte.desanexar(idAba);
        return true;
      } catch {
        // A aba fechou ou o debugger já tinha saído: não há mais o que desfazer.
        return false;
      }
    },
  };
}
