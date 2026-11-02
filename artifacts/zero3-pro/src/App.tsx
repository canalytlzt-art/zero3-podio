import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useSearch } from 'wouter';
import { getGetZero3MeQueryKey, useGetZero3Me } from '@workspace/api-client-react';
import { Zero3Role } from '@workspace/api-client-react';
import { DashboardPage, EventDetailPage, EventsPage, MembersPage, RosterPage } from '@/pages/AdminPages';
import { PublicTV } from '@/pages/PublicTV';
import { OperationPage } from '@/pages/OperationPage';
import {
  canonicalClerkSearch,
  clerkLocationWithSearch,
  clerkRedirectDestination,
  sanitizeClerkRedirectSearch,
  signInHrefForProtectedPath,
} from '@/lib/auth-redirect';

const queryClient = new QueryClient({defaultOptions:{queries:{staleTime:1500,refetchOnWindowFocus:true,retry:1}}});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path:string){
  if(!basePath)return path;
  if(path===basePath)return '/';
  return path.startsWith(`${basePath}/`)?path.slice(basePath.length):path;
}
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
  const signInHref=signInHrefForProtectedPath(`${window.location.pathname}${window.location.search}${window.location.hash}`,basePath,window.location.origin);
  if(!isLoaded)return <div className="app-shell"><div className="content" style={{margin:'auto',width:'100%'}}><div className="skeleton"/></div></div>;
  if(!isSignedIn)return <Redirect to={signInHref} replace/>;
  return <RoleProtected>{children}</RoleProtected>;
}
function RoleProtected({children}:{children:ReactNode}){
  const me=useGetZero3Me({query:{queryKey:getGetZero3MeQueryKey(),refetchOnWindowFocus:true}});
  if(me.isLoading)return <div className="app-shell"><div className="content" style={{margin:'auto',width:'100%'}}><div className="skeleton"/></div></div>;
  if(me.isError){
    const status='status' in me.error&&typeof me.error.status==='number'?me.error.status:undefined;
    const code=apiErrorCode(me.error);
    const sessionInvalid=status===401||code==='SESSION_INVALID';
    const noRole=status===403||code==='ZERO3_ROLE_INACTIVE'||code==='ZERO3_ROLE_INSUFFICIENT';
    const providerFailure=code==='AUTH_PROVIDER_UNAVAILABLE';
    const databaseFailure=code==='DATABASE_UNAVAILABLE';
    const dependencyFailure=providerFailure||databaseFailure||status===503||status===502||status===504||status===undefined;
    const title=sessionInvalid?'Sua sessão precisa ser confirmada.':noRole?'Acesso operacional não habilitado.':providerFailure?'Provedor de autenticação indisponível.':databaseFailure?'Banco de dados indisponível.':dependencyFailure?'Serviço de operação indisponível.':'Falha interna da API.';
    const detail=sessionInvalid?'Entre novamente com a conta da organização para abrir o painel.':noRole?'Esta conta está autenticada, mas não possui uma função ativa no ZERO3. Peça a um administrador para revisar o acesso.':providerFailure?'Não foi possível validar sua sessão com o Clerk. Tente novamente; este erro não altera sua função.':databaseFailure?'Não foi possível consultar os dados de autorização. Tente novamente; isso não significa que sua conta perdeu permissões.':dependencyFailure?'Um serviço necessário está temporariamente indisponível. Tente novamente; isso não significa que sua conta perdeu permissões.':'A API encontrou um erro ao processar a autorização. Tente novamente; este erro não indica falta de permissão.';
    return <div className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></div><div className="auth-copy"><div className="eyebrow">{sessionInvalid?'Sessão inválida':noRole?'Acesso restrito':providerFailure?'Falha do Clerk':databaseFailure?'Falha do banco':dependencyFailure?'Falha de conexão':'Erro da API'}</div><h1>{title}</h1><p>{detail}</p></div><span className="auth-hint">ZERO3 PRO · ACESSO</span></section><section className="auth-form"><div>{sessionInvalid?<Link href="/sign-in" className="button primary">Entrar novamente</Link>:<RetryButton retry={()=>me.refetch()}/>}</div></section></div>;
  }
  if(![Zero3Role.ADMIN,Zero3Role.JUIZ_CHEFE,Zero3Role.JUIZ].includes(me.data?.role as typeof Zero3Role[keyof typeof Zero3Role]))return <div className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></div><div className="auth-copy"><div className="eyebrow">Acesso restrito</div><h1>Operação autorizada somente.</h1><p>Esta conta não possui uma função ativa para acessar o painel.</p></div><span className="auth-hint">ZERO3 PRO · CONTROLE</span></section><section className="auth-form"><p className="notice">Função atual: {me.data?.role||'indisponível'}</p><RetryButton retry={()=>me.refetch()}/></section></div>;
  return <>{children}</>;
}
function apiErrorCode(error:unknown):string|undefined{
  if(typeof error!=='object'||error===null||!('data' in error))return undefined;
  const data=(error as {data?:unknown}).data;
  if(typeof data!=='object'||data===null||!('code' in data))return undefined;
  const code=(data as {code?:unknown}).code;
  return typeof code==='string'?code:undefined;
}
function RetryButton({retry}:{retry:()=>void}){return <button className="button" style={{marginTop:12}} onClick={retry}>Verificar autorização novamente</button>}

function useSanitizedClerkRedirects(){
  const [,setLocation]=useLocation();
  // Wouter's useSearch subscribes to navigation but removes the leading "?"
  // (and unescapes some characters). Use the browser's raw search as input.
  const wouterSearch=useSearch();
  const rawSearch=window.location.search;
  const currentSearch=canonicalClerkSearch(rawSearch);
  const safeSearch=sanitizeClerkRedirectSearch(rawSearch,basePath,window.location.origin);
  const redirectsReady=safeSearch===currentSearch;
  useEffect(()=>{
    if(redirectsReady)return;
    setLocation(
      clerkLocationWithSearch(
        stripBase(window.location.pathname),
        safeSearch,
        window.location.hash,
      ),
      {replace:true},
    );
  },[wouterSearch,rawSearch,safeSearch,redirectsReady,setLocation]);
  return redirectsReady;
}

function AuthLoading(){return <div className="app-shell"><div className="content" style={{margin:'auto',width:'100%'}}><div className="skeleton"/></div></div>}

function SignInPage(){
  const redirectsReady=useSanitizedClerkRedirects();
  if(!redirectsReady)return <AuthLoading/>;
  return <div className="auth-shell"><section className="auth-brand"><Link href="/" className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></Link><div className="auth-copy"><div className="eyebrow">Controle de competição</div><h1>O placar vê o esforço. Você mantém o ritmo.</h1><p>Uma superfície precisa para operar crews de funcional fitness em Santa Catarina.</p></div><span className="auth-hint">ZERO3 PRO · SC / RX</span></section><section className="auth-form"><div style={{width:'100%',maxWidth:460}}><div className="eyebrow">Bem-vindo de volta</div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={clerkRedirectDestination(window.location.search,'sign-in',basePath,window.location.origin)}/></div></section></div>;
}
function SignUpPage(){
  const redirectsReady=useSanitizedClerkRedirects();
  if(!redirectsReady)return <AuthLoading/>;
  return <div className="auth-shell"><section className="auth-brand"><Link href="/" className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></Link><div className="auth-copy"><div className="eyebrow">Equipe de operação</div><h1>Entre no ritmo da competição.</h1><p>Crie sua conta para solicitar acesso operacional ao ZERO3 PRO.</p></div><span className="auth-hint">ZERO3 PRO · SC / RX</span></section><section className="auth-form"><div style={{width:'100%',maxWidth:460}}><div className="eyebrow">Criar conta</div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={clerkRedirectDestination(window.location.search,'sign-up',basePath,window.location.origin)}/></div></section></div>;
}

function AdminEntryRedirect(){
  return <Redirect to="/admin" replace/>;
}

function AppRoutes(){
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Acessar ZERO3 PRO',subtitle:'Entre para operar a competição'}},signUp:{start:{title:'Criar acesso ZERO3 PRO',subtitle:'Solicite acesso à equipe de operação'}}}} routerPush={(to:string)=>setLocation(stripBase(to))} routerReplace={(to:string)=>setLocation(stripBase(to),{replace:true})}>
    <QueryClientProvider client={queryClient}><CacheInvalidator/><TooltipProvider><RoutedErrorBoundary><Switch>
      <Route path="/" component={AdminEntryRedirect}/>
      <Route path="/inicio" component={AdminEntryRedirect}/>
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
