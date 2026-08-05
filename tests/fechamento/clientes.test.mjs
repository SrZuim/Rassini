/* ==========================================================================
   §25 — Testes do CADASTRO UNIFICADO DE CLIENTES
   Sem a unificação, o mesmo cliente vira três denominadores diferentes e o PPM
   externo fica errado sem ninguém perceber. Estes testes travam esse contrato.
   ========================================================================== */
import { suite, teste, esperar } from '../runner.mjs';
import { normalizar, similaridade, classificarCliente } from '../../services/fechamento/fm-clientes.js';

const ALIASES = [
  { id: 'a1', nome_oficial: 'Volkswagen Caminhões e Ônibus', ativo: true,
    apelidos: ['MAN Latin América', 'VW'], nome_faturamento: 'VOLKSWAGEN CAM E ONIBUS' },
  { id: 'a2', nome_oficial: 'Mercedes-Benz do Brasil', ativo: true, apelidos: [] },
  { id: 'a3', nome_oficial: 'Scania Latin America', ativo: false, apelidos: ['Scania'] }
];

suite('§25 — normalização de nomes', () => {

  teste('remove acentos', () => {
    esperar(normalizar('Volkswagen Caminhões e Ônibus')).igual('VOLKSWAGEN CAMINHOES E ONIBUS');
  });

  teste('remove pontuação e hífen', () => {
    esperar(normalizar('Mercedes-Benz')).igual('MERCEDES BENZ');
    esperar(normalizar('J.C. Peças, Ltda.')).igual('J C PECAS');
  });

  teste('remove sufixo societário e "do Brasil"', () => {
    esperar(normalizar('Randon Implementos LTDA')).igual('RANDON IMPLEMENTOS');
    esperar(normalizar('Mercedes-Benz do Brasil')).igual('MERCEDES BENZ');
  });

  teste('colapsa espaços múltiplos', () => {
    esperar(normalizar('  VW    Caminhoes  ')).igual('VW CAMINHOES');
  });

  teste('entrada vazia ou nula não quebra', () => {
    esperar(normalizar(null)).igual('');
    esperar(normalizar('')).igual('');
  });
});

suite('§25 — similaridade', () => {

  teste('nomes idênticos após normalização têm similaridade 1', () => {
    esperar(similaridade('Mercedes-Benz', 'MERCEDES BENZ')).igual(1);
  });

  teste('erro de digitação mantém similaridade alta', () => {
    esperar(similaridade('Mercedez Benz', 'Mercedes Benz') > 0.85).verdadeiro();
  });

  teste('nomes sem relação têm similaridade baixa', () => {
    esperar(similaridade('Volkswagen', 'Randon') < 0.4).verdadeiro();
  });
});

suite('§25 — classificação do cliente', () => {

  teste('nome oficial exato → reconhecido', () => {
    const r = classificarCliente('Volkswagen Caminhões e Ônibus', ALIASES);
    esperar(r.classificacao).igual('reconhecido');
    esperar(r.oficial).igual('Volkswagen Caminhões e Ônibus');
  });

  teste('apelido cadastrado → reconhecido', () => {
    esperar(classificarCliente('MAN Latin América', ALIASES).oficial).igual('Volkswagen Caminhões e Ônibus');
    esperar(classificarCliente('VW', ALIASES).oficial).igual('Volkswagen Caminhões e Ônibus');
  });

  teste('nome usado no faturamento → reconhecido', () => {
    esperar(classificarCliente('VOLKSWAGEN CAM E ONIBUS', ALIASES).classificacao).igual('reconhecido');
  });

  teste('nome desconhecido → nao_cadastrado', () => {
    const r = classificarCliente('Fábrica XYZ Componentes', ALIASES);
    esperar(r.classificacao).igual('nao_cadastrado');
    esperar(r.oficial).nulo();
  });

  teste('erro de digitação → possivel, com sugestão e SEM associação automática', () => {
    const r = classificarCliente('Mercedez Benz', ALIASES);
    esperar(r.classificacao).igual('possivel');
    esperar(r.oficial).nulo();
    esperar(r.sugestao).igual('Mercedes-Benz do Brasil');
  });

  teste('cliente INATIVO não é usado para associação', () => {
    esperar(classificarCliente('Scania', ALIASES).classificacao).igual('nao_cadastrado');
  });

  teste('mesmo apelido em dois clientes → duplicidade', () => {
    const conflito = [...ALIASES, { id: 'x', nome_oficial: 'Outra Empresa', ativo: true, apelidos: ['VW'] }];
    const r = classificarCliente('VW', conflito);
    esperar(r.classificacao).igual('duplicidade');
    esperar(r.oficial).nulo();
    esperar(r.candidatos).tamanho(2);
  });

  teste('nome vazio não é associado a ninguém', () => {
    esperar(classificarCliente('', ALIASES).classificacao).igual('nao_cadastrado');
    esperar(classificarCliente(null, ALIASES).classificacao).igual('nao_cadastrado');
  });

  teste('cadastro vazio devolve nao_cadastrado sem quebrar', () => {
    esperar(classificarCliente('Volkswagen', []).classificacao).igual('nao_cadastrado');
  });
});
