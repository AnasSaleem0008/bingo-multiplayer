const socket=io();
const lobby=document.getElementById("lobby"),room=document.getElementById("room"),game=document.getElementById("game");
const nameInput=document.getElementById("nameInput"),joinNameInput=document.getElementById("joinNameInput"),roomInput=document.getElementById("roomInput");
const createBtn=document.getElementById("createBtn"),joinBtn=document.getElementById("joinBtn"),startBtn=document.getElementById("startBtn"),leaveBtn=document.getElementById("leaveBtn"),leaveGameBtn=document.getElementById("leaveGameBtn"),newGameBtn=document.getElementById("newGameBtn"),overlayNewGame=document.getElementById("overlayNewGame");
const lobbyMessage=document.getElementById("lobbyMessage"),roomMessage=document.getElementById("roomMessage"),gameMessage=document.getElementById("gameMessage");
const roomCode=document.getElementById("roomCode"),myName=document.getElementById("myName"),players=document.getElementById("players"),playersGame=document.getElementById("playersGame");
const turnText=document.getElementById("turnText"),gameStatus=document.getElementById("gameStatus"),lastNumber=document.getElementById("lastNumber"),calledBy=document.getElementById("calledBy"),timerText=document.getElementById("timerText"),board=document.getElementById("board");
const winnerOverlay=document.getElementById("winnerOverlay"),winnerTitle=document.getElementById("winnerTitle"),winnerSub=document.getElementById("winnerSub"),confetti=document.getElementById("confetti");
const chatForm=document.getElementById("chatForm"),chatInput=document.getElementById("chatInput"),chatMessages=document.getElementById("chatMessages"),chatCount=document.getElementById("chatCount");
let myId=null,myNameValue="",myBoard=[],marked=new Set(),gameStarted=false,currentTurn=null,winner=null,turnEndsAt=0,timerInterval=null,audioCtx=null;

function show(section){
  lobby.classList.add("hidden");room.classList.add("hidden");game.classList.add("hidden");
  section.classList.remove("hidden");
}
function setMessage(el,text){el.textContent=text||""}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function makeBoard(numbers){myBoard=numbers;marked.clear();board.innerHTML="";numbers.forEach((n,i)=>{const b=document.createElement("button");b.className="box";b.textContent=n;b.disabled=true;b.addEventListener("click",()=>{playSound("click");socket.emit("selectNumber",{number:n})});board.appendChild(b)})}
function renderBoard(){[...board.children].forEach((box,i)=>{const n=myBoard[i];box.classList.toggle("marked",marked.has(n));box.disabled=!gameStarted||currentTurn!==myId||marked.has(n)||!!winner})}
function renderPlayers(list){const make=gameMode=>list.map(p=>{const active=p.id===currentTurn?"active":"",win=p.id===winner?"winner":"",you=p.id===myId?"you":"";if(gameMode)return `<div class="score-player ${active} ${win} ${you}"><div class="score-name">${escapeHtml(p.name)} ${p.id===myId?'<span class="score-you">YOU</span>':''}</div><div class="score-lines">${p.lines}<small> / 10 lines</small></div></div>`;return `<span class="player ${active} ${win}">${escapeHtml(p.name)}${p.id===myId?" (You)":""}</span>`}).join("");players.innerHTML=make(false);playersGame.innerHTML=make(true)}
function checkLocalLines(){const size=10,complete=[];const check=idx=>idx.every(i=>marked.has(myBoard[i]));for(let r=0;r<size;r++)if(check(Array.from({length:size},(_,c)=>r*size+c)))complete.push(1);for(let c=0;c<size;c++)if(check(Array.from({length:size},(_,r)=>r*size+c)))complete.push(1);if(check(Array.from({length:size},(_,i)=>i*size+i)))complete.push(1);if(check(Array.from({length:size},(_,i)=>i*size+(size-1-i))))complete.push(1);return complete.length}
function startTimer(end){turnEndsAt=end;clearInterval(timerInterval);const tick=()=>{const left=Math.max(0,Math.ceil((turnEndsAt-Date.now())/1000));timerText.textContent=left;if(left<=3)timerText.parentElement.classList.add("urgent");else timerText.parentElement.classList.remove("urgent");if(left<=0)clearInterval(timerInterval)};tick();timerInterval=setInterval(tick,200)}
function resetTimer(){clearInterval(timerInterval);timerInterval=null;timerText.textContent="—"}
function playSound(type){try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);const now=audioCtx.currentTime;if(type==="click"){o.frequency.setValueAtTime(520,now);o.frequency.exponentialRampToValueAtTime(760,now+.08)}else{const notes=[523,659,784,1047];notes.forEach((f,i)=>{const x=audioCtx.createOscillator(),y=audioCtx.createGain();x.connect(y);y.connect(audioCtx.destination);x.frequency.value=f;y.gain.setValueAtTime(.0001,now+i*.12);y.gain.exponentialRampToValueAtTime(.13,now+i*.12+.02);y.gain.exponentialRampToValueAtTime(.0001,now+i*.12+.22);x.start(now+i*.12);x.stop(now+i*.12+.23)});return}g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.12,now+.01);g.gain.exponentialRampToValueAtTime(.0001,now+.12);o.start(now);o.stop(now+.13)}catch(e){}}
function celebrate(name){winnerOverlay.classList.remove("hidden");winnerTitle.textContent=winner===myId?"🏆 YOU WIN!":"🏆 "+name+" WINS!";winnerSub.textContent=name+" reached 10 lines first!";playSound("win");confetti.innerHTML="";for(let i=0;i<90;i++){const p=document.createElement("i");p.className="confetti-piece";p.style.left=Math.random()*100+"vw";p.style.animationDelay=Math.random()*.8+"s";p.style.transform=`rotate(${Math.random()*360}deg)`;p.style.background=`hsl(${Math.random()*360},90%,60%)`;confetti.appendChild(p)}setTimeout(()=>confetti.innerHTML="",4000)}

function resetChat(){
  chatMessages.innerHTML='<div class="chat-empty">No messages yet. Say hello! 👋</div>';
  chatCount.textContent="0";
}
function addChatMessage(data){
  if(chatMessages.querySelector(".chat-empty")) chatMessages.innerHTML="";
  const row=document.createElement("div");
  row.className="chat-message"+(data.playerId===myId?" mine":"");
  const meta=document.createElement("div");
  meta.className="chat-meta";
  meta.textContent=(data.playerId===myId?"You":data.playerName)+" • "+new Date(data.sentAt||Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const body=document.createElement("div");
  body.className="chat-body";
  body.textContent=data.message;
  row.append(meta,body);
  chatMessages.appendChild(row);
  chatMessages.scrollTop=chatMessages.scrollHeight;
  chatCount.textContent=String(chatMessages.querySelectorAll(".chat-message").length);
}
chatForm.addEventListener("submit",e=>{
  e.preventDefault();
  const message=chatInput.value.trim();
  if(!message)return;
  socket.emit("chatMessage",{message});
  chatInput.value="";
  chatInput.focus();
});

socket.on("chatMessage",addChatMessage);

createBtn.onclick=()=>{myNameValue=nameInput.value.trim()||"Player";socket.emit("createRoom",{name:myNameValue})};
leaveGameBtn.onclick=()=>{
  if(confirm("Leave the game? You will be removed from the active player list and will no longer take turns.")){
    socket.emit("leaveGame");
  }
};
joinBtn.onclick=()=>{myNameValue=joinNameInput.value.trim()||"Player";socket.emit("joinRoom",{name:myNameValue,code:roomInput.value})};
startBtn.onclick=()=>socket.emit("startGame");leaveBtn.onclick=()=>socket.emit("leaveRoom");
newGameBtn.onclick=()=>{winnerOverlay.classList.add("hidden");socket.emit("startGame")};overlayNewGame.onclick=()=>{winnerOverlay.classList.add("hidden");socket.emit("startGame")};

socket.on("connect",()=>{myId=socket.id;setMessage(lobbyMessage,"")});
socket.on("connect_error",()=>{setMessage(lobbyMessage,"Unable to connect to the game server. Make sure the server is running.")});
socket.on("disconnect",()=>{if(gameStarted){resetTimer();setMessage(gameMessage,"Connection lost. Reconnect to the game server to continue.")}});
socket.on("roomCreated",data=>{roomCode.textContent=data.code;myName.textContent=myNameValue;show(room);setMessage(roomMessage,"Share this room code with the other players.")});
socket.on("roomJoined",data=>{roomCode.textContent=data.code;myName.textContent=myNameValue;show(room);setMessage(roomMessage,"Waiting for the host to start the game...")});
socket.on("roomUpdate",data=>{roomCode.textContent=data.code;renderPlayers(data.players);if(!gameStarted&&!game.classList.contains("hidden"))show(room);startBtn.disabled=data.players.length<2;startBtn.textContent=data.players.length<2?"Waiting for 2+ players":"▶ Start Game"});
socket.on("gameStarted",data=>{resetChat();gameStarted=true;winner=null;currentTurn=data.currentTurn;lastNumber.textContent="—";calledBy.textContent="Waiting for the first call...";setMessage(gameMessage,"");newGameBtn.classList.add("hidden");winnerOverlay.classList.add("hidden");makeBoard(data.board);renderPlayers(data.players);turnText.textContent=data.currentTurn===myId?"🔥 YOUR TURN":"⏳ "+data.currentTurnName+"'s turn";gameStatus.textContent=data.currentTurn===myId?"Pick one number before the timer reaches zero!":"Wait for your turn...";startTimer(data.turnEndsAt);renderBoard();show(game)});
socket.on("numberCalled",data=>{marked.add(data.number);lastNumber.textContent=data.number;calledBy.textContent=data.automatic?`${data.playerName} timed out — ${data.number} was auto-selected`:`${data.playerName} selected ${data.number}`;currentTurn=data.nextTurn;renderPlayers(data.players);if(data.automatic)playSound("click");if(currentTurn){turnText.textContent=currentTurn===myId?"🔥 YOUR TURN":"⏳ "+data.nextTurnName+"'s turn";gameStatus.textContent=currentTurn===myId?"Your turn — choose a number!":"Wait for the other player...";startTimer(data.turnEndsAt)}else resetTimer();renderBoard()});
socket.on("playerLeft",data=>{
  currentTurn=data.nextTurn;
  renderPlayers(data.players);
  turnText.textContent=currentTurn===myId?"🔥 YOUR TURN":"⏳ "+data.nextTurnName+"'s turn";
  gameStatus.textContent=currentTurn===myId?"Your turn — choose a number!":"Wait for your turn...";
  if(currentTurn && data.turnEndsAt) startTimer(data.turnEndsAt);
  else resetTimer();
  // Deliberately do not show the departed player's name/status.
  setMessage(gameMessage,"");
  renderBoard();
});
socket.on("gameLeft",data=>{resetChat();gameStarted=false;winner=null;currentTurn=null;resetTimer();setMessage(lobbyMessage,"You left the game.");show(lobby)});
socket.on("gameOver",data=>{winner=data.winnerId;gameStarted=false;currentTurn=null;resetTimer();renderPlayers(data.players);turnText.textContent=data.winnerId===myId?"🏆 YOU WIN!":"🏆 "+data.winnerName+" WINS!";gameStatus.textContent="10 lines completed!";setMessage(gameMessage,`${data.winnerName} reached 10 lines first.`);newGameBtn.classList.remove("hidden");renderBoard();celebrate(data.winnerName)});
socket.on("gameEnded",data=>{gameStarted=false;winner=null;currentTurn=null;resetTimer();renderPlayers(data.players);turnText.textContent="🛑 GAME ENDED";gameStatus.textContent="There are not enough active players to continue.";setMessage(gameMessage,"The game ended because fewer than 2 active players remain.");newGameBtn.classList.remove("hidden");renderBoard()});
socket.on("errorMessage",msg=>{const visible=game.classList.contains("hidden")?room.classList.contains("hidden")?lobbyMessage:roomMessage:gameMessage;setMessage(visible,msg)});
socket.on("roomLeft",()=>{resetChat();gameStarted=false;winner=null;currentTurn=null;resetTimer();show(lobby);setMessage(lobbyMessage,"You left the room.")});
socket.on("resetToLobby",msg=>{resetChat();gameStarted=false;winner=null;currentTurn=null;resetTimer();show(lobby);setMessage(lobbyMessage,msg||"Room closed.")});

// ==============================
// EMOJI BUTTONS
// ==============================

function addEmoji(emoji) {
  const input = document.getElementById("chatInput");

  if (!input) return;

  input.value += emoji;
  input.focus();
}
