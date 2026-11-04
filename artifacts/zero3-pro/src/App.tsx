import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { isSessionScopedZero3QueryKey } from './lib/session-query-cache';
import { shouldRefetchAfterError, shouldRetryZero3Query } from './lib/api-error-policy';
import { Zero3Role } from '@workspace/api-client-react';
import { DashboardPage, EventDetailPage, EventsPage, MembersPage, RosterPage } from '@/pages/AdminPages';
import { RosterManagePage } from '@/pages/RosterManagePage';
import { RosterImportPage } from '@/pages/RosterImportPage';
import { PublicTV } from '@/pages/PublicTV';
import { LiveBoardPage } from '@/pages/LiveBoardPage';
import { OperationPage } from '@/pages/OperationPage';
import {
  canonicalClerkSearch,
  clerkLocationWithSearch,
  clerkRedirectDestination,
  endCurrentSessionForReauthentication,
  sanitizeClerkRedirectSearch,
  signInHrefForProtectedPath,
} from '@/lib/auth-redirect';

const queryClient = new QueryClient({defaultOptions:{queries:{staleTime:1500,refetchOnWindowFocus:query=>shouldRefetchAfterError(query.state.error),refetchOnReconnect:query=>shouldRefetchAfterError(query.state.error),retry:shouldRetryZero3Query}}});
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
  useEffect(()=>addListener(({user})=>{const id=user?.id??null;if(prev.current!==undefined&&prev.current!==id)qc.removeQueries({predicate:({queryKey})=>isSessionScopedZero3QueryKey(queryKey)});prev.current=id;}),[addListener,qc]);
  return null;
}

function RoutedErrorBoundary({children}:{children:ReactNode}){
  const [location]=useLocation();return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function Protected({children}:{children:ReactNode}){
  const {isLoaded,isSignedIn}=useAuth();
  const initializationTimedOut=usePendingTimeout(!isLoaded,15_000);
  const signInHref=signInHrefForProtectedPath(`${window.location.pathname}${window.location.search}${window.location.hash}`,basePath,window.location.origin);
  if(!isLoaded)return initializationTimedOut?<ClerkStartupFailure/>:<AuthLoading message="Inicializando o Clerk…"/>;
  if(!isSignedIn)return <Redirect to={signInHref} replace/>;
  return <RoleProtected>{children}</RoleProtected>;
}
function RoleProtected({children}:{children:ReactNode}){
  const reloginHref=signInHrefForProtectedPath(`${window.location.pathname}${window.location.search}${window.location.hash}`,basePath,window.location.origin);
  const me=useGetZero3Me({query:{queryKey:getGetZero3MeQueryKey(),refetchOnWindowFocus:query=>shouldRefetchAfterError(query.state.error),refetchOnReconnect:query=>shouldRefetchAfterError(query.state.error),retry:false}});
  const requestTimedOut=usePendingTimeout(me.isLoading,15_000);
  if(me.isLoading)return requestTimedOut?<ApiRequestTimeout retry={()=>me.refetch()}/>:<AuthLoading message="Consultando sessão e permissões…"/>;
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
    const requestId=apiErrorRequestId(me.error);
    return <div className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></div><div className="auth-copy"><div className="eyebrow">{sessionInvalid?'Sessão inválida':noRole?'Acesso restrito':providerFailure?'Falha do Clerk':databaseFailure?'Falha do banco':dependencyFailure?'Falha de conexão':'Erro da API'}</div><h1>{title}</h1><p>{detail}</p>{requestId&&<p className="lede" style={{marginTop:12}}>Referência: {requestId}</p>}</div><span className="auth-hint">ZERO3 PRO · ACESSO</span></section><section className="auth-form"><div>{sessionInvalid?<ReauthenticateButton redirectTo={reloginHref}/>:<RetryButton retry={()=>me.refetch()}/>}</div></section></div>;
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
function apiErrorRequestId(error:unknown):string|undefined{
  if(typeof error!=='object'||error===null||!('data' in error))return undefined;
  const data=(error as {data?:unknown}).data;
  if(typeof data!=='object'||data===null||!('requestId' in data))return undefined;
  const requestId=(data as {requestId?:unknown}).requestId;
  return typeof requestId==='string'||typeof requestId==='number'?String(requestId):undefined;
}
function RetryButton({retry}:{retry:()=>void}){return <button className="button" style={{marginTop:12}} onClick={retry}>Verificar autorização novamente</button>}
function ReauthenticateButton({redirectTo}:{redirectTo:string}){
  const {signOut}=useClerk();
  const qc=useQueryClient();
  const [error,setError]=useState(false);
  return <><button className="button primary" style={{marginTop:12}} onClick={()=>{setError(false);qc.removeQueries({predicate:({queryKey})=>isSessionScopedZero3QueryKey(queryKey)});void endCurrentSessionForReauthentication(signOut,redirectTo).catch(()=>setError(true));}}>Encerrar sessão e entrar novamente</button>{error&&<p role="alert" className="lede" style={{marginTop:10}}>Não foi possível encerrar a sessão agora. Recarregue e tente novamente.</p>}</>;
}

function useSanitizedClerkRedirects(){
  const [,setLocation]=useLocation();
  // Use Wouter's hook only to subscribe to navigation changes. Canonicalize
  // both compared values from the browser's raw search, independent of how
  // a Wouter version represents its search string.
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

function usePendingTimeout(pending:boolean,timeoutMs:number){
  const [timedOut,setTimedOut]=useState(false);
  useEffect(()=>{
    if(!pending){setTimedOut(false);return;}
    const timer=window.setTimeout(()=>setTimedOut(true),timeoutMs);
    return ()=>window.clearTimeout(timer);
  },[pending,timeoutMs]);
  return timedOut;
}
function AuthLoading({message='Preparando o endereço de acesso…'}:{message?:string}){
  return <div className="app-shell"><div className="content" style={{margin:'auto',width:'100%'}}><div className="skeleton"/><p role="status" aria-live="polite">{message}</p></div></div>;
}
function ClerkStartupFailure(){
  return <div className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></div><div className="auth-copy"><div className="eyebrow">Falha do Clerk</div><h1>O login não foi inicializado.</h1><p>O serviço de autenticação não respondeu no tempo esperado. Tente recarregar; este estado não altera sua sessão ou permissão.</p></div><span className="auth-hint">ZERO3 PRO · ACESSO</span></section><section className="auth-form"><button className="button primary" onClick={()=>window.location.reload()}>Recarregar login</button></section></div>;
}
function ApiRequestTimeout({retry}:{retry:()=>void}){
  return <div className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></div><div className="auth-copy"><div className="eyebrow">Falha da API</div><h1>A autorização não respondeu.</h1><p>A API não concluiu a consulta em 15 segundos. Isso não indica falta de permissão; tente novamente.</p></div><span className="auth-hint">ZERO3 PRO · CONTROLE</span></section><section className="auth-form"><RetryButton retry={retry}/></section></div>;
}

function SignInPage(){
  const {isLoaded}=useAuth();
  const redirectsReady=useSanitizedClerkRedirects();
  const initializationTimedOut=usePendingTimeout(!isLoaded,15_000);
  if(!redirectsReady)return <AuthLoading/>;
  if(!isLoaded)return initializationTimedOut?<ClerkStartupFailure/>:<AuthLoading message="Inicializando o login…"/>;
  return <div className="auth-shell"><section className="auth-brand"><Link href="/" className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></Link><div className="auth-copy"><div className="eyebrow">Controle de competição</div><h1>O placar vê o esforço. Você mantém o ritmo.</h1><p>Uma superfície precisa para operar crews de funcional fitness em Santa Catarina.</p></div><span className="auth-hint">ZERO3 PRO · SC / RX</span></section><section className="auth-form"><div style={{width:'100%',maxWidth:460}}><div className="eyebrow">Bem-vindo de volta</div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={clerkRedirectDestination(window.location.search,'sign-in',basePath,window.location.origin)}/></div></section></div>;
}
function SignUpPage(){
  const {isLoaded}=useAuth();
  const redirectsReady=useSanitizedClerkRedirects();
  const initializationTimedOut=usePendingTimeout(!isLoaded,15_000);
  if(!redirectsReady)return <AuthLoading/>;
  if(!isLoaded)return initializationTimedOut?<ClerkStartupFailure/>:<AuthLoading message="Inicializando o cadastro…"/>;
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
      <Route path="/placar-ao-vivo" component={LiveBoardPage}/>
      <Route path="/operacao"><Protected><OperationPage/></Protected></Route>
      <Route path="/sign-in/*?" component={SignInPage}/>
      <Route path="/sign-up/*?" component={SignUpPage}/>
      <Route path="/admin/events/:eventId"><Protected><EventDetailPage/></Protected></Route>
      <Route path="/admin/events"><Protected><EventsPage/></Protected></Route>
      <Route path="/admin/roster"><Protected><RosterPage/></Protected></Route>
      <Route path="/admin/roster/manage"><Protected><RosterManagePage/></Protected></Route>
      <Route path="/admin/roster/import"><Protected><RosterImportPage/></Protected></Route>
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
