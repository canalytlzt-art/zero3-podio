import { useRef } from 'react';
import { BookOpen, X } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import './RulesDialog.css';

const ruleTabs = [
  { value: 'overview', label: 'Visão geral' },
  { value: 'proof-1', label: 'Prova 1' },
  { value: 'proof-2', label: 'Prova 2' },
  { value: 'proof-3', label: 'Prova 3' },
  { value: 'proof-4', label: 'Prova 4' },
] as const;

export function RulesDialog() {
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="zero3-rules-trigger" type="button" data-testid="button-public-rules">
          <BookOpen size={14} aria-hidden="true" />
          <span>Regras</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="zero3-rules-dialog"
        overlayClassName="zero3-rules-overlay"
        closeLabel="Fechar regras"
        closeTestId="button-close-rules-icon"
        aria-modal="true"
        aria-describedby="zero3-rules-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogHeader className="zero3-rules-header">
          <div className="zero3-rules-kicker"><span /> REGULAMENTO OFICIAL</div>
          <DialogTitle ref={titleRef} tabIndex={-1} className="zero3-rules-title">
            Regras do evento
          </DialogTitle>
          <DialogDescription id="zero3-rules-description" className="zero3-rules-subtitle">
            RX e Scaled · Orientações das quatro provas
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="zero3-rules-tabs">
          <TabsList className="zero3-rules-tab-list" aria-label="Seções do regulamento">
            {ruleTabs.map((tab, index) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="zero3-rules-tab"
                data-testid={`tab-rules-${tab.value}`}
              >
                <span className="zero3-rules-tab-index">{String(index).padStart(2, '0')}</span>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="zero3-rules-panel" data-testid="panel-rules-overview">
            <article className="zero3-rules-copy">
              <h2>Regras do ZERO3</h2>
              <h3>Visão geral</h3>
              <p><strong>Categorias: RX e Scaled.</strong></p>
              <p>Confira as orientações das quatro provas e os padrões da sua categoria antes de competir. Respeite as demarcações das raias e dos equipamentos, siga as orientações da arbitragem e observe as regras de alternância entre atletas. Confira também as cargas, os equipamentos e os ajustes permitidos.</p>
            </article>
          </TabsContent>

          <TabsContent value="proof-1" className="zero3-rules-panel" data-testid="panel-rules-proof-1">
            <article className="zero3-rules-copy">
              <h2>Prova 1 — Carga máxima</h2>
              <p>O objetivo é realizar uma repetição válida de cada levantamento:</p>
              <ul>
                <li><strong>Snatch 1RM:</strong> Power Snatch ou Squat Snatch.</li>
                <li><strong>Clean 1RM:</strong> Power Clean ou Squat Clean.</li>
              </ul>
              <p>Você pode escolher a variação, desde que respeite os padrões técnicos do levantamento.</p>
            </article>
          </TabsContent>

          <TabsContent value="proof-2" className="zero3-rules-panel" data-testid="panel-rules-proof-2">
            <article className="zero3-rules-copy">
              <h2>Prova 2 — Sled e bike</h2>
              <h3>Travessia do sled</h3>
              <p>O sled deve ultrapassar completamente a marcação. A passagem não será válida se qualquer parte do equipamento permanecer antes da linha.</p>
              <h3>Raias</h3>
              <p>Cada equipe deve permanecer na própria raia. Não é permitido invadir a raia adversária.</p>
              <h3>Cargas do sled</h3>
              <ul>
                <li><strong>RX: 150 kg — 5 anilhas de 20 kg.</strong></li>
                <li><strong>Scaled: 110 kg — 3 anilhas de 20 kg.</strong></li>
              </ul>
              <p>Confira a carga correspondente à sua categoria.</p>
              <h3>Painel e ajustes da bike</h3>
              <ul>
                <li>A arbitragem será responsável por zerar o painel no início de cada round.</li>
                <li><strong>Atletas não podem tocar ou manipular o painel.</strong></li>
                <li>O único ajuste permitido aos atletas é a altura do banco.</li>
              </ul>
            </article>
          </TabsContent>

          <TabsContent value="proof-3" className="zero3-rules-panel" data-testid="panel-rules-proof-3">
            <article className="zero3-rules-copy">
              <h2>Prova 3 — Padrões de movimento</h2>
              <h3>Barra — RX</h3>
              <ul>
                <li>Homens e mulheres podem executar Bar Muscle-Up (BMU).</li>
                <li><strong>Homens não podem executar Pull-Up.</strong></li>
                <li>Se a atleta feminina optar por fazer BMU, deverá realizar posteriormente, sozinha, os Pull-Ups prescritos.</li>
              </ul>
              <p><strong>Exceção de alternância entre BMU e Pull-Up:</strong> os atletas podem alternar a execução enquanto completam seus movimentos.</p>
              <p>Exemplo de alternância:</p>
              <ol>
                <li>O homem faz 8 BMUs e sai.</li>
                <li>A mulher faz 10 Pull-Ups e sai.</li>
                <li>O homem retorna e finaliza seus BMUs.</li>
                <li>A mulher retorna e finaliza seus Pull-Ups.</li>
              </ol>
              <p>Essa é a única exceção à sequência prescrita. Todos os demais movimentos devem seguir exatamente a execução estabelecida na prova.</p>
              <h3>Barra — Scaled</h3>
              <p>Os atletas podem escolher entre Jumping Pull-Up e Pull-Up tradicional.</p>
              <p><strong>Informe a escolha previamente à arbitragem</strong>, para que a base de execução seja ajustada corretamente.</p>
              <h3>Burpee com salto sobre anilha</h3>
              <p>Respeite a fita que demarca a distância do salto em relação à anilha. A execução deve seguir a marcação do espaço de competição.</p>
              <h3>Box Jump / Step Over</h3>
              <ul>
                <li><strong>RX:</strong> Box Jump com descida em Step Down. A altura masculina da caixa é de <strong>60 cm</strong>.</li>
                <li><strong>Scaled:</strong> Step Over segurando a Medicine Ball em posição de Bear Hug, abraçada ao tronco.</li>
              </ul>
              <h3>Wall Ball</h3>
              <p>Para a repetição ser válida, a bola deve ultrapassar a linha correspondente:</p>
              <ul>
                <li><strong>Masculino:</strong> acima da linha azul.</li>
                <li><strong>Feminino:</strong> acima da linha rosa.</li>
              </ul>
              <h3>Wall Walk</h3>
              <ul>
                <li><strong>RX:</strong> padrão oficial de movimento do CrossFit Open.</li>
                <li><strong>Scaled:</strong> padrão adaptado de Wall Walk utilizado no CrossFit Open para a divisão Scaled.</li>
              </ul>
              <p>Respeite as demarcações e os padrões da sua categoria.</p>
              <h3>Handstand Push-Up (HSPU)</h3>
              <p>Haverá uma placa de EVA ao lado da caixa. Antes de iniciar suas repetições, posicione o EVA no local indicado e confira a posição das mãos:</p>
              <ul>
                <li><strong>A palma da mão deve permanecer dentro da área demarcada.</strong></li>
                <li>Os dedos podem ultrapassar a linha de demarcação.</li>
              </ul>
            </article>
          </TabsContent>

          <TabsContent value="proof-4" className="zero3-rules-panel" data-testid="panel-rules-proof-4">
            <article className="zero3-rules-copy">
              <h2>Prova 4 — Ergômetros</h2>
              <p><strong>A troca dos ergômetros deve acontecer a cada 500 metros de corrida na esteira.</strong></p>
              <p>Acompanhe a distância indicada nos painéis para realizar as trocas no momento correto. Respeite a sequência prevista na prova e as orientações da arbitragem.</p>
              <p className="zero3-rules-signature"><strong>ZERO3 GAMES | ZERO3 PRO</strong></p>
              <p className="zero3-rules-closing">Boa prova a todos! 💚💜</p>
            </article>
          </TabsContent>
        </Tabs>

        <DialogFooter className="zero3-rules-footer">
          <span>ZERO3 GAMES <i /> CONSULTA PÚBLICA</span>
          <DialogClose asChild>
            <button className="zero3-rules-close" type="button" data-testid="button-close-rules">
              <X size={15} aria-hidden="true" /> Fechar
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
