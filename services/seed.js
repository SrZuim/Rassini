/* ==========================================================================
   RNA One — Dados semente (modo demo)
   Espelham as tabelas do Supabase. Em produção, o db.js busca do backend.
   ========================================================================== */

export const SEED = {
  usuarios: [
    { id:'u1', nome:'Jorge Lucas',     email:'jorgelucaszuim@gmail.com', role:'admin',      matricula:'RNA-0001', area:'Qualidade',  planta:'Planta São Bernardo', avatar:null, ativo:true },
    { id:'u2', nome:'Hatus de Azevedo Neves', email:'supervisor@rassini.com', role:'supervisor', matricula:'01614', area:'CQ - Supervisor', planta:'Planta Rio Nova Iguaçu', avatar:null, ativo:true },
    { id:'u3', nome:'Ana Beatriz',     email:'ana@rassini.com',          role:'auditor',    matricula:'RNA-0233', area:'Montagem',   planta:'Planta São Bernardo', avatar:null, ativo:true },
    { id:'u4', nome:'Carlos Mendes',   email:'carlos@rassini.com',       role:'auditor',    matricula:'RNA-0234', area:'Tratamento', planta:'Planta São Bernardo', avatar:null, ativo:true },
    { id:'u5', nome:'Visitante',       email:'visita@rassini.com',       role:'visitante',  matricula:'—',        area:'—',          planta:'Planta São Bernardo', avatar:null, ativo:true }
  ],
  areas: [
    { id:'a1', nome:'Estamparia',  responsavel:'Hatus de Azevedo Neves', planta:'Planta Rio Nova Iguaçu' },
    { id:'a2', nome:'Montagem',    responsavel:'Ana Beatriz',     planta:'Planta Rio Nova Iguaçu' },
    { id:'a3', nome:'Tratamento Térmico', responsavel:'Carlos Mendes', planta:'Planta Rio Nova Iguaçu' },
    { id:'a4', nome:'Usinagem',    responsavel:'Hatus de Azevedo Neves', planta:'Planta Rio Nova Iguaçu' }
  ],
  linhas: [
    { id:'l1', nome:'Linha 01 — Molas', area:'Estamparia', maquinas:4 },
    { id:'l2', nome:'Linha 02 — Feixes', area:'Montagem',  maquinas:5 },
    { id:'l3', nome:'Linha 03 — Têmpera', area:'Tratamento Térmico', maquinas:3 },
    { id:'l4', nome:'Linha 04 — Usinagem CNC', area:'Usinagem', maquinas:6 }
  ],
  maquinas: [
    { id:'m1', tag:'PR-1450', nome:'Prensa Hidráulica 1450T', linha:'Linha 01 — Molas', area:'Estamparia', criticidade:'Alta', status:'Operando', oee:87 },
    { id:'m2', tag:'PR-0800', nome:'Prensa Excêntrica 800T',  linha:'Linha 01 — Molas', area:'Estamparia', criticidade:'Média', status:'Operando', oee:79 },
    { id:'m3', tag:'FN-0204', nome:'Forno de Têmpera 204',    linha:'Linha 03 — Têmpera', area:'Tratamento Térmico', criticidade:'Alta', status:'Atenção', oee:71 },
    { id:'m4', tag:'CN-0312', nome:'Centro Usinagem CNC 312', linha:'Linha 04 — Usinagem CNC', area:'Usinagem', criticidade:'Média', status:'Operando', oee:91 },
    { id:'m5', tag:'MT-0501', nome:'Montadora de Feixes 501', linha:'Linha 02 — Feixes', area:'Montagem', criticidade:'Alta', status:'Parada', oee:0 },
    { id:'m6', tag:'GR-0118', nome:'Granalhadora 118',        linha:'Linha 03 — Têmpera', area:'Tratamento Térmico', criticidade:'Baixa', status:'Operando', oee:83 }
  ],
  rotinas: [
    { id:'r1', codigo:'RT-001', nome:'Inspeção de proteções — Prensa 1450T', descricao:'Verificar cortinas de luz e botoeiras de emergência.', area:'Estamparia', linha:'Linha 01 — Molas', maquina:'PR-1450', turno:'1º Turno (06:00–14:20)', horario:'07:00', tempo_padrao:15, criticidade:'Alta', obrigatoria:true, foto_obrigatoria:true, obs_obrigatoria:true, status:'Concluída', auditor:'u3' },
    { id:'r2', codigo:'RT-002', nome:'Checagem de lubrificação — Forno 204', descricao:'Conferir níveis e pontos de lubrificação automática.', area:'Tratamento Térmico', linha:'Linha 03 — Têmpera', maquina:'FN-0204', turno:'1º Turno (06:00–14:20)', horario:'08:30', tempo_padrao:20, criticidade:'Alta', obrigatoria:true, foto_obrigatoria:true, obs_obrigatoria:false, status:'Em andamento', auditor:'u3' },
    { id:'r3', codigo:'RT-003', nome:'Controle dimensional — Usinagem 312', descricao:'Medição de amostra conforme plano de controle.', area:'Usinagem', linha:'Linha 04 — Usinagem CNC', maquina:'CN-0312', turno:'1º Turno (06:00–14:20)', horario:'09:15', tempo_padrao:25, criticidade:'Média', obrigatoria:true, foto_obrigatoria:false, obs_obrigatoria:true, status:'Pendente', auditor:'u3' },
    { id:'r4', codigo:'RT-004', nome:'Verificação 5S — Linha 02', descricao:'Auditoria 5S do posto de montagem.', area:'Montagem', linha:'Linha 02 — Feixes', maquina:'MT-0501', turno:'1º Turno (06:00–14:20)', horario:'10:00', tempo_padrao:18, criticidade:'Baixa', obrigatoria:false, foto_obrigatoria:false, obs_obrigatoria:false, status:'Pendente', auditor:'u3' },
    { id:'r5', codigo:'RT-005', nome:'Ruído e temperatura — Granalhadora', descricao:'Medir nível de ruído e temperatura de mancais.', area:'Tratamento Térmico', linha:'Linha 03 — Têmpera', maquina:'GR-0118', turno:'1º Turno (06:00–14:20)', horario:'11:00', tempo_padrao:12, criticidade:'Média', obrigatoria:true, foto_obrigatoria:true, obs_obrigatoria:true, status:'Postergada', auditor:'u3' },
    { id:'r6', codigo:'RT-006', nome:'Inspeção de segurança — Prensa 800T', descricao:'Validar bloqueios e dispositivos de segurança.', area:'Estamparia', linha:'Linha 01 — Molas', maquina:'PR-0800', turno:'1º Turno (06:00–14:20)', horario:'12:30', tempo_padrao:15, criticidade:'Alta', obrigatoria:true, foto_obrigatoria:true, obs_obrigatoria:true, status:'Não executada', auditor:'u3' }
  ],
  atividades: [
    { id:'at1', rotina:'RT-001', maquina:'PR-1450', peca:'Mola parabólica 3F', quantidade:120, inicio:'07:02', fim:'07:14', tempo:12, tempo_padrao:15, resultado:'Conforme', obs:'Cortinas de luz OK.', justificativa:null, auditor:'u3' },
    { id:'at2', rotina:'RT-002', maquina:'FN-0204', peca:'Feixe 5 lâminas', quantidade:0, inicio:'08:31', fim:null, tempo:0, tempo_padrao:20, resultado:'Em execução', obs:'', justificativa:null, auditor:'u3' },
    { id:'at3', rotina:'RT-005', maquina:'GR-0118', peca:'—', quantidade:0, inicio:'11:05', fim:'11:34', tempo:29, tempo_padrao:12, resultado:'Atenção', obs:'Ruído acima do normal no mancal.', justificativa:'Aguardando equipe de manutenção liberar a máquina.', auditor:'u3' }
  ],
  auditorias: [
    { id:'au1', codigo:'AUD-2401', tipo:'Processo', area:'Estamparia', linha:'Linha 01 — Molas', auditor:'u3', data:'2026-06-28', conformidade:96, ncs:1, status:'Concluída' },
    { id:'au2', codigo:'AUD-2402', tipo:'Segurança', area:'Tratamento Térmico', linha:'Linha 03 — Têmpera', auditor:'u4', data:'2026-06-28', conformidade:82, ncs:3, status:'Em andamento' },
    { id:'au3', codigo:'AUD-2403', tipo:'5S', area:'Montagem', linha:'Linha 02 — Feixes', auditor:'u3', data:'2026-06-27', conformidade:90, ncs:1, status:'Concluída' },
    { id:'au4', codigo:'AUD-2404', tipo:'Produto', area:'Usinagem', linha:'Linha 04 — Usinagem CNC', auditor:'u4', data:'2026-06-26', conformidade:99, ncs:0, status:'Concluída' }
  ],
  checklist: [
    { id:'ck1', maquina:'PR-1450', linha:'Linha 01 — Molas', auditor:'u3', data:'2026-06-28', turno:'1º Turno (06:00–14:20)', resultado:'Aprovado', criticos:0, status:'Concluída' },
    { id:'ck2', maquina:'FN-0204', linha:'Linha 03 — Têmpera', auditor:'u4', data:'2026-06-28', turno:'1º Turno (06:00–14:20)', resultado:'Reprovado', criticos:1, status:'Concluída' },
    { id:'ck3', maquina:'MT-0501', linha:'Linha 02 — Feixes', auditor:'u3', data:'2026-06-28', turno:'1º Turno (06:00–14:20)', resultado:'Pendente', criticos:0, status:'Em andamento' }
  ],
  nao_conformidades: [
    { id:'nc1', codigo:'NC-0451', tipo:'Segurança', categoria:'EPI', origem:'Auditoria', maquina:'FN-0204', linha:'Linha 03 — Têmpera', descricao:'Vazamento de óleo hidráulico no Forno 204 com risco de escorregamento.', severidade:'Alta', responsavel:'u4', prazo:'2026-06-29', status:'Em andamento', abertura:'2026-06-28', area:'Tratamento Térmico' },
    { id:'nc2', codigo:'NC-0452', tipo:'Produto', categoria:'Dimensional', origem:'Checklist', maquina:'CN-0312', linha:'Linha 04 — Usinagem CNC', descricao:'Cota de furação fora de tolerância em amostra de feixe.', severidade:'Média', responsavel:'u3', prazo:'2026-07-01', status:'Aberta', abertura:'2026-06-28', area:'Usinagem' },
    { id:'nc3', codigo:'NC-0453', tipo:'Máquina', categoria:'Manutenção', origem:'Rotina', maquina:'MT-0501', linha:'Linha 02 — Feixes', descricao:'Montadora 501 parada por falha no cilindro pneumático.', severidade:'Crítica', responsavel:'u2', prazo:'2026-06-28', status:'Em análise', abertura:'2026-06-28', area:'Montagem' },
    { id:'nc4', codigo:'NC-0449', tipo:'Processo', categoria:'5S', origem:'Auditoria', maquina:'PR-0800', linha:'Linha 01 — Molas', descricao:'Ferramentas fora do shadow board no posto da prensa 800T.', severidade:'Baixa', responsavel:'u3', prazo:'2026-06-30', status:'Resolvida', abertura:'2026-06-25', area:'Estamparia' },
    { id:'nc5', codigo:'NC-0447', tipo:'Segurança', categoria:'Setup', origem:'Inspeção', maquina:'PR-1450', linha:'Linha 01 — Molas', descricao:'Botoeira de emergência com resposta lenta.', severidade:'Alta', responsavel:'u2', prazo:'2026-06-26', status:'Encerrada', abertura:'2026-06-22', area:'Estamparia' }
  ],
  planos_acao: [
    { id:'pa1', nc:'NC-0451', codigo:'PA-0451', responsavel:'u4', prazo:'2026-06-29', acao:'Substituir vedação do cilindro hidráulico e conter vazamento com bandeja.', status:'Em andamento', progresso:60, abertura:'2026-06-28' },
    { id:'pa2', nc:'NC-0453', codigo:'PA-0453', responsavel:'u2', prazo:'2026-06-28', acao:'Acionar manutenção corretiva e substituir cilindro pneumático da montadora.', status:'Atrasado', progresso:30, abertura:'2026-06-28' },
    { id:'pa3', nc:'NC-0449', codigo:'PA-0449', responsavel:'u3', prazo:'2026-06-29', acao:'Reorganizar shadow board e treinar operadores em 5S.', status:'Concluído', progresso:100, abertura:'2026-06-25' }
  ],
  comunicados: [
    { id:'c1', titulo:'Semana Interna de Prevenção de Acidentes (SIPAT 2026)', resumo:'Programação completa de 06 a 10/07. Participação obrigatória.', autor:'RH / SESMT', data:'2026-06-27', tag:'Segurança', img:'assets/rassini/banner-3.jpeg', fixado:true },
    { id:'c2', titulo:'Novo procedimento de troca rápida (SMED) na Estamparia', resumo:'Atualização do PO-ES-014 com tempos-alvo de setup.', autor:'Engenharia de Processos', data:'2026-06-26', tag:'Processo', img:'assets/rassini/banner-1.jpeg', fixado:false },
    { id:'c3', titulo:'Resultados de Qualidade — Maio/2026', resumo:'PPM externo atingiu meta pelo 4º mês consecutivo.', autor:'Qualidade', data:'2026-06-24', tag:'Qualidade', img:'assets/rassini/banner-6.jpg', fixado:false }
  ],
  documentos: [
    { id:'d1', nome:'PO-ES-014 — Troca Rápida de Ferramental', tipo:'Procedimento', area:'Estamparia', versao:'3.2', data:'2026-06-26', tamanho:'1.4 MB' },
    { id:'d2', nome:'IT-QA-008 — Plano de Controle Molas', tipo:'Instrução', area:'Qualidade', versao:'2.0', data:'2026-05-18', tamanho:'820 KB' },
    { id:'d3', nome:'FM-SEG-002 — Checklist de Segurança Prensas', tipo:'Formulário', area:'Segurança', versao:'1.5', data:'2026-04-30', tamanho:'310 KB' },
    { id:'d4', nome:'MAN-MN-021 — Manutenção Forno de Têmpera', tipo:'Manual', area:'Manutenção', versao:'4.1', data:'2026-03-12', tamanho:'5.2 MB' }
  ],
  treinamentos: [
    { id:'t1', nome:'NR-12 — Segurança em Máquinas e Equipamentos', carga:'8h', categoria:'Segurança', progresso:100, status:'Concluído', img:'assets/rassini/banner-2.jpg' },
    { id:'t2', nome:'Auditoria de Processo por Camadas (LPA)', carga:'4h', categoria:'Qualidade', progresso:65, status:'Em andamento', img:'assets/rassini/banner-5.jpeg' },
    { id:'t3', nome:'Lean Manufacturing & Gestão à Vista', carga:'6h', categoria:'Melhoria Contínua', progresso:0, status:'Não iniciado', img:'assets/rassini/banner-7.jpeg' },
    { id:'t4', nome:'Indústria 4.0 aplicada à Manufatura', carga:'10h', categoria:'Tecnologia', progresso:20, status:'Em andamento', img:'assets/rassini/banner-8.jpeg' }
  ],
  logs: [
    { id:'g1', usuario:'Ana Beatriz', acao:'Concluiu rotina RT-001', entidade:'rotina', antes:'Em andamento', depois:'Concluída', quando:'2026-06-28 07:14', dispositivo:'Tablet RNA-T07 · 10.20.4.18' },
    { id:'g2', usuario:'Carlos Mendes', acao:'Abriu NC-0451', entidade:'nao_conformidade', antes:'—', depois:'Aberta', quando:'2026-06-28 08:40', dispositivo:'Coletor RNA-C12 · 10.20.4.33' },
    { id:'g3', usuario:'Marcos Oliveira', acao:'Aprovou Plano PA-0449', entidade:'plano_acao', antes:'Em andamento', depois:'Concluído', quando:'2026-06-28 09:02', dispositivo:'Desktop SUP-02 · 10.20.1.5' }
  ],
  notificacoes: [
    { id:'n1', tipo:'crit', titulo:'Defeito crítico', texto:'NC-0453 — Montadora 501 parada (Crítica).', quando:'há 12 min', lida:false },
    { id:'n2', tipo:'warn', titulo:'Tempo excedido', texto:'RT-005 ultrapassou o tempo padrão (29/12 min).', quando:'há 40 min', lida:false },
    { id:'n3', tipo:'warn', titulo:'Rotina atrasada', texto:'RT-006 não executada no horário previsto.', quando:'há 1 h', lida:false },
    { id:'n4', tipo:'info', titulo:'Novo comunicado', texto:'SIPAT 2026 publicada pelo RH / SESMT.', quando:'há 5 h', lida:true }
  ]
};
