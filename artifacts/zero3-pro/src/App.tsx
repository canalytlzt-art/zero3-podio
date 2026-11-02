import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { getGetZero3MeQueryKey, useGetZero3Me } from '@workspace/api-client-react';
import { Zero3Role } from '@workspace/api-client-react';
import { DashboardPage, EventDetailPage, EventsPage, MembersPage, RosterPage } from '@/pages/AdminPages';
import { PublicTV } from '@/pages/PublicTV';
import { PublicEntry } from '@/pages/PublicEntry';
import { OperationPage } from '@/pages/OperationPage';

const queryClient = new QueryClient({defaultOptions:{queries:{staleTime:1500,refetchOnWindowFocus:true,retry:1}}});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path:string){return basePath&&path.startsWith(basePath)?path.slice(basePath.length)||'/':path;}
if(!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement:'inside' as const, logoLinkUrl:basePath||'/', logoImageUrl:`${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary:'#426e57', colorForeground:'#303831', colorMutedForeground:'#777c74',
    colorDanger:'#a34238', colorBackground:'#fbfaf6', colorInput:'#fffefa',
    colorInputForeground:'#303831', colorNeutral:'#dcd9cf', fontFamily:'Manrope, sans-serif', borderRadius:'0.65rem',
  },
  elements: {
    rootBox:'w-full flex justify-center',
    cardBox:'bg-[#fbfaf6] rounded-xl w-[440px] max-w-full overflow-hidden border border-[#dfddd4]',
    card:'!shadow-none !border-0 !bg-transparent !rounded-none',
    footer:'!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle:'text-[#303831] font-bold tracking-tight',
    headerSubtitle:'text-[#777c74]',
    socialButtonsBlockButtonText:'text-[#414740] font-semibold',
    formFieldLabel:'text-[#545b53] font-semibold',
    footerActionLink:'text-[#426e57] font-semibold',
    footerActionText:'text-[#777c74]',
    dividerText:'text-[#777c74]',
    identityPreviewEditButton:'text-[#426e57]',
    formFieldSuccessText:'text-[#426e57]',
    alertText:'text-[#8e4338]',
    logoBox:'mb-4',
    logoImage:'max-h-9',
    socialButtonsBlockButton:'border border-[#dfddd4] bg-[#fffefa] rounded-lg',
    formButtonPrimary:'bg-[#426e57] hover:bg-[#345b46] text-white rounded-lg',
    formFieldInput:'bg-[#fffefa] border-[#dcd9cf] text-[#303831] rounded-lg',
    footerAction:'border-0',
    dividerLine:'bg-[#dfddd4]',
    alert:'bg-[#fbefec] border-[#e2c7c2]',
    otpCodeFieldInput:'bg-[#fffefa] border-[#dcd9cf] text-[#303831]',
    formFieldRow:'mb-4',
    main:'gap-4',
  },
};

function CacheInvalidator(){
  const {addListener}=useClerk();const qc=useQueryClient();const prev=useRef<string|null|undefined>(undefined);
  useEffect(()=>addListener(({user})=>{const id=user?.id??null;if(prev.current!==undefined&&prev.current!==id)qc.clear();prev.current=id;}),[addListener,qc]);
  return null;
}

function RoutedErrorBoundary({children}:{children:ReactNode}){
  const [location]=useLocation();return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function Protected({children}:{children:ReactNode}){
  const {isLoaded,isSignedIn}=useAuth();
  if(!isLoaded)return <div className="app-shell"><div className="content" style={{margin:'auto',width:'100%'}}><div className="skeleton"/></div></div>;
  if(!isSignedIn)return <div className="auth-shell"><section className="auth-brand"><Link href="/" className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></Link><div className="auth-copy"><div className="eyebrow">Acesso restrito</div><h1>Precisão começa no controle.</h1><p>Entre para operar provas, equipes, cronômetro e resultados. A transmissão pública permanece separada.</p></div><span className="auth-hint">ZERO3 PRO · OPERAÇÃO</span></section><section className="auth-form"><div style={{maxWidth:440,textAlign:'center'}}><h2 style={{fontSize:22,letterSpacing:'-.05em'}}>Acesso da equipe</h2><p className="lede" style={{marginBottom:18}}>Entre com sua conta para abrir o painel de controle.</p><Link href="/sign-in" className="button primary">Entrar na operação</Link><div style={{marginTop:18}}><Link href="/" className="button">Voltar para a TV pública</Link></div></div></section></div>;
  return <RoleProtected>{children}</RoleProtected>;
}
function RoleProtected({children}:{children:ReactNode}){
  const me=useGetZero3Me({query:{queryKey:getGetZero3MeQueryKey(),refetchOnWindowFocus:true}});
  if(me.isLoading)return <div className="app-shell"><div className="content" style={{margin:'auto',width:'100%'}}><div className="skeleton"/></div></div>;
  if(me.isError){
    const status='status' in me.error&&typeof me.error.status==='number'?me.error.status:undefined;
    const sessionInvalid=status===401;
    const noRole=status===403;
    const title=sessionInvalid?'Sua sessão precisa ser confirmada.':noRole?'Acesso operacional não habilitado.':'Serviço de operação indisponível.';
    const detail=sessionInvalid?'Entre novamente com a conta da organização para abrir o painel.':noRole?'Esta conta está autenticada, mas não possui uma função ativa no ZERO3. Peça a um administrador para revisar o acesso.':'Não foi possível consultar a autorização agora. Isso não significa que sua conta perdeu permissões.';
    return <div className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></div><div className="auth-copy"><div className="eyebrow">{sessionInvalid?'Sessão inválida':noRole?'Acesso restrito':'Falha na API'}</div><h1>{title}</h1><p>{detail}</p></div><span className="auth-hint">ZERO3 PRO · ACESSO</span></section><section className="auth-form"><div>{sessionInvalid?<Link href="/sign-in" className="button primary">Entrar novamente</Link>:<RetryButton retry={()=>me.refetch()}/>}</div></section></div>;
  }
  if(![Zero3Role.ADMIN,Zero3Role.JUIZ_CHEFE,Zero3Role.JUIZ].includes(me.data?.role as typeof Zero3Role[keyof typeof Zero3Role]))return <div className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></div><div className="auth-copy"><div className="eyebrow">Acesso restrito</div><h1>Operação autorizada somente.</h1><p>Esta conta não possui uma função ativa para acessar o painel.</p></div><span className="auth-hint">ZERO3 PRO · CONTROLE</span></section><section className="auth-form"><p className="notice">Função atual: {me.data?.role||'indisponível'}</p><RetryButton retry={()=>me.refetch()}/></section></div>;
  return <>{children}</>;
}
function RetryButton({retry}:{retry:()=>void}){return <button className="button" style={{marginTop:12}} onClick={retry}>Verificar autorização novamente</button>}

function SignInPage(){return <div className="auth-shell"><section className="auth-brand"><Link href="/" className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></Link><div className="auth-copy"><div className="eyebrow">Controle de competição</div><h1>O placar vê o esforço. Você mantém o ritmo.</h1><p>Uma superfície precisa para operar crews de funcional fitness em Santa Catarina.</p></div><span className="auth-hint">ZERO3 PRO · SC / RX</span></section><section className="auth-form"><div style={{width:'100%',maxWidth:460}}><div className="eyebrow">Bem-vindo de volta</div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/admin`} fallbackRedirectUrl={`${basePath}/admin`}/></div></section></div>}
function SignUpPage(){return <div className="auth-shell"><section className="auth-brand"><Link href="/" className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></Link><div className="auth-copy"><div className="eyebrow">Equipe de operação</div><h1>Entre no ritmo da competição.</h1><p>Crie sua conta para solicitar acesso operacional ao ZERO3 PRO.</p></div><span className="auth-hint">ZERO3 PRO · SC / RX</span></section><section className="auth-form"><div style={{width:'100%',maxWidth:460}}><div className="eyebrow">Criar conta</div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/admin`} fallbackRedirectUrl={`${basePath}/admin`}/></div></section></div>}

function HomeRoute(){
  const {isLoaded,isSignedIn}=useAuth();
  if(!isLoaded)return <div className="app-shell"><div className="content" style={{margin:'auto',width:'100%'}}><div className="skeleton"/></div></div>;
  return <Redirect to={isSignedIn?'/admin':'/sign-in'}/>;
}

function AppRoutes(){
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Acessar ZERO3 PRO',subtitle:'Entre para operar a competição'}},signUp:{start:{title:'Criar acesso ZERO3 PRO',subtitle:'Solicite acesso à equipe de operação'}}}} routerPush={(to:string)=>setLocation(stripBase(to))} routerReplace={(to:string)=>setLocation(stripBase(to),{replace:true})}>
    <QueryClientProvider client={queryClient}><CacheInvalidator/><TooltipProvider><RoutedErrorBoundary><Switch>
      <Route path="/" component={HomeRoute}/>
      <Route path="/inicio" component={PublicEntry}/>
      <Route path="/tv" component={PublicTV}/>
      <Route path="/operacao"><Protected><OperationPage/></Protected></Route>
      <Route path="/sign-in/*?" component={SignInPage}/>
      <Route path="/sign-up/*?" component={SignUpPage}/>
      <Route path="/admin/events/:eventId"><Protected><EventDetailPage/></Protected></Route>
      <Route path="/admin/events"><Protected><EventsPage/></Protected></Route>
      <Route path="/admin/roster"><Protected><RosterPage/></Protected></Route>
      <Route path="/admin/members"><Protected><MembersPage/></Protected></Route>
      <Route path="/admin"><Protected><DashboardPage/></Protected></Route>
      <Route component={NotFound}/>
    </Switch></RoutedErrorBoundary><Toaster/></TooltipProvider></QueryClientProvider>
  </ClerkProvider>;
}
function App(){
  return <WouterRouter base={basePath}><AppRoutes/></WouterRouter>;
}
export default App;
