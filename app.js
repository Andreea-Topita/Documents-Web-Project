const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const cookieParser=require('cookie-parser');
//citeste si parseaza cookie-urile din cereri http in req.cookies

const sqlite3 = require('sqlite3').verbose(); 
//activeaza mesaje de debugging pentru sqlite3     

//citire asincrona a jsonului
//importam lista de intrebari din fisierul json
// fisierul json contine un array de obiecte cu intrebari, variante si raspuns corect
const fs = require('fs').promises;
const session = require('express-session');

//deschidem fisierul de baza de date SQLite
const dbFile = path.join(__dirname, 'cumparaturi.db');
//db file cale absoluta catre baza de date
// __dirname este directorul in care se afla acest fisier app.js
const db     = new sqlite3.Database(dbFile, err => {
  //deschide baza de date , si callback te anunta daca a reusit 
  if (err) 
    console.error('Eroare la deschiderea BD:', err);
  else        
    console.log('BD SQLite deschisă:', dbFile);
});

// funcție pentru a executa comenzi SQL care nu returnează date
// (e.g., CREATE, INSERT, UPDATE, DELETE)
const execute = (db, sql, params = []) => {
  // returnează un Promise care se rezolvă când comanda SQL este executată
  // db.run este metoda care execută o comandă SQL
  // params sunt parametrii pentru comanda SQL, folosiți pentru a preveni SQL injection
  // dacă nu sunt parametri, se folosește un array gol
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) 
        reject(err);
      else resolve();
    });
  });
};

const app = express();

const port = 6789;
const blacklist = {};

// doua obiecte pentru a urmari esecurile
const loginFailuresByIp   = {};  // { [ip]:   { count, blockedUntil } }
const loginFailuresByUser = {};  // { [user]:{ count, blockedUntil } }

app.use(cookieParser());
//analizam headerele cookie si umplem req.cookies cu un obiect 

// directorul 'views' va conține fișierele .ejs (html + js executat la server)
app.set('view engine', 'ejs');
// suport pentru layout-uri – implicit fișierul template este views/layout.ejs
app.use(expressLayouts);
// directorul 'public' va conține toate resursele accesibile direct de către client
// (e.g., fișiere css, javascript, imagini)
app.use(express.static('public'));
// corpul mesajului poate fi interpretat ca JSON; datele de la formular se găsesc
// în format JSON în req.body
app.use(bodyParser.json());

// utilizarea unui algoritm de deep parsing care suportă obiecte în obiecte
app.use(bodyParser.urlencoded({ extended: true }));



// middleware pentru gestionarea sesiunilor
//middleware-ul va salva datele sesiunii in memorie
//middleware = functie care se executa inainte de a ajunge la ruta
app.use(session({
  secret: 'secret-key',     
  // cheia secreta pentru criptarea sesiunii
  resave: false,
  //nu se rescrie sesiune la fiecare cerere daca nu s a modificat
  saveUninitialized: false,
  //nu  cream sesiune pe server pana nu punem ceva in ea
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // sesiune valabilă 1 zi
}));
//la fiecare cerere de la client: middl analieaza cookie ul , decripteaza, incarca un ob req session , la sf raspunsul 
 
//disponibil in toate view-urile ca variabila "user"
app.use((req, res, next) => {
  //res.locals este un obiect care conține variabilele disponibile în toate view-urile
  //daca nu exista sesiunea, userul este null

  res.locals.user = req.session.user;
  res.locals.userType = req.session.userType;
  next();
});
//urm middle sa fie invocat => next


app.use((req, res, next) => {
  //daca cererea e well know => 404
  if (req.path.startsWith('/.well-known/')) {
      return res.status(404).render('error', {
        status: 404,
        message: 'Resursă nu a fost găsită.'
      });
    }

    //extragem ip clientului din cerere
    const ip = req.ip;
    //cautam in lista intrarea pentru acest ip 
    const entry = blacklist[ip];
    //daca exista intrarea si este blocat pana la un timp in viitor( 10 sec)
    if (entry && entry.blockedUntil > Date.now()) {
      return res.status(403).render('error', {
        status: 403,
        message: '⛔ Sunteți blocat! Încercați din nou peste 10 secunde.'
      });
    }
    //daca nu am returnat niciun raspuns, apelam next() pt ca cererea sa continue la urm middleware sau handler
    //daca nu e blocat, trecem la urmatorul middleware
    next();
});


//middleware pentru a face coșul de cumpărături disponibil în toate view-urile
// va fi disponibil in toate view-urile ca variabila "cos"
// daca nu exista cosul, il initializam ca obiect gol
app.use((req, res, next) => {
  res.locals.cos = req.session.cos || {};
  next();
});

//middleware pentru protectie a rutei /admin 
//verifica orice cerere catre admin 
app.use((req, res, next) => {
  //dac aurl incepe cu admin 
  if (req.path.startsWith('/admin')) {
    //verific tipul de utilizator salvat in sesiune 
    if (req.session.userType !== 'ADMIN') {
      //daca nu e admin eroare 
      return res.status(403).render('error', {
        status: 403,
        message: '⛔ Acces interzis: doar ADMIN.'
      });
    }
  }
  //daca e admin, next()
  next();
});

//403 - Forbidden, resursa exista dar utilizatorul nu are drept 
//404 - Not Found nu exista resursa ceruta


//get, afisez formularul 
//mesaj e pentru post mai mult, cand chiar afizez mesajul de succes sau eroare
app.get('/admin', (req, res) => {

  //mesaj folosit cand revin dupa post, ca sa afisez mesajul de succes sau eroare
  res.render('admin', { mesaj: null });
});

async function loadUtilizatori() {
  //obtinem calea completa catre fisierul utilizatori.json
  const filePath = path.join(__dirname, 'utilizatori.json');

  //citim continutul fis ca text ( read file utf 8)
  const data = await fs.readFile(filePath, 'utf8');

  //ia stringu si l transforma in array de obiecte java script, lista de utilizatori pe care o primesc la apelul await loadUtilizatori()
  return JSON.parse(data);
}

//functie asicrona de incarcare a fisierului json , primise se va rezolva cu un array de intrebari
async function loadIntrebari() {
  //functie async introarce un promise
    const filePath = path.join(__dirname, 'intrebari.json');
    //dir name e directorul in care se afla app.js , path join construieste path absolut cu intrebari json
    const data = await fs.readFile(filePath, 'utf8');
    //fs readFile citeste fisierul asicron pana primeste continutul , data - string cu tot json ul 
    return JSON.parse(data);
    //transforma stringul intr un ob js => array de intrebari
}


//LAB12 data base - o singura data ca sa initializam
app.get('/creare-bd', async (req, res) => {
  const sql = `
    CREATE TABLE IF NOT EXISTS produse (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nume TEXT NOT NULL,
      pret REAL NOT NULL
      descriere TEXT
    );
  `;

  try {
    // execută comanda SQL pentru a crea tabela
    //execute este o funcție care returnează un Promise
    await execute(db, sql);
    console.log('Tabela produse creată (sau deja existentă)');
  } catch (err) {
    console.error('Eroare la creare tabelă:', err);
  }
  // redirect la pagina principala
  res.redirect('/');
});

//produse de test
app.get('/inserare-bd', async (req, res) => {
  const produse = [
    ['Foi Albe A4',       10.00, 'Foi albe A4,pachet de 500 de file'],
    ['Pix Albastru',      2.50, 'Pix cu cerneală albastră'],
    ['Caiet 100 File',   8.00, 'Caiet cu 100 de file, liniat'],
    ['Mapă Plastică',    4.00, 'Mapă plastică pentru documente'],
    ['Creion',        1.80, 'Creion grafic'],
    ['Marker Permanent',  3.00, 'Marker permanent negru'],
  ];

  try {
    // pentru fiecare produs, execută comanda SQL de inserare
    //folosesc execute ca sa execut comanda SQL
    //folosesc await ca sa astept sa se termine inserarea in baza de date
    for (const [nume, pret, descriere] of produse) {
      const sql = `
        INSERT INTO produse (nume, pret, descriere)
        VALUES (?, ?, ?)
      `;
      await execute(db, sql, [nume, pret, descriere]);
    }
    console.log('Documente inserate cu succes în tabela "produse"');
  } catch (err) {
    console.error('Eroare la inserare produse:', err);
  }
  // redirect la pagina principala
  res.redirect('/');
});



// la accesarea din browser adresei  se va apela functia 
app.get('/chestionar',async  (req, res) => {
    try {
      // async incat sa pot folosi await 
        const intrebari = await loadIntrebari();
        //incarcare si parsare json , var intrebari devine array de ob intrebari

        //trimit catr ejs un ob cu 2 proprietati : titlu si intrebari , array citit din fisier 

        res.render('chestionar', {
            //titlu: 'Chestionar Documente',
            intrebari
        });
    } catch (err) { //trimit 500 daca ceva a mers prost
        console.error('Eroare la citirea întrebărilor:', err);
        res.status(500).send('A apărut o eroare pe server.');
      }
});


//post, procesare raspunsuri chestionar
app.post('/rezultat-chestionar', async (req, res) => {
    try {
        const intrebari = await loadIntrebari();

        const raspunsuri = req.body; //toate raspunsurile\
        //req.body obiect cu perechi cheie valoare pentru fiecare camp trimis 

        let cnt = 0; // contor pt a numara nr de rasp corect
    
        //parcurg fiecare item si pozitia lui in listaIntrebari
        //verific daca raspunsul utilizatorului este corect

        //item.intrebare - text intrebare; item variante - array de optiuni , item.corect idex varianta corecta 
        intrebari.forEach(item  => {
            const ales = raspunsuri[item.intrebare];
            //extrag din boxy valoarea pe care a ales-o utilizatorul
            if (ales === item.variante[item.corect]) {
            //verific daca rasp corect este egal cu varianta corecta
                //daca este corect, incrementam contorul
                cnt++;
            }
        });

        //trimitem catre pagina rezultat-chestionar.ejs nr de rasp corecte si total 
        
        res.render('rezultat-chestionar', {
          //titlu: 'Rezultatul chestionarului',
          nrRaspCorecte: cnt,
          totalIntrebari: intrebari.length
        });
    } catch (err) {
        console.error('Eroare la procesarea rezultatelor:', err);
        res.status(500).send('A apărut o eroare pe server.');
        //er 500 
    }
  });


//index.ejs
app.get('/', (req, res) => {
  const utilizator = req.session.user || null;
  //daca nu exista sesiunea, utilizatorul este null
  //daca exista sesiunea, utilizatorul este obiectul salvat in sesiune

  //selecteaza toate produsele din tabela produse
  //db.all ruleaza query si apo apeleaza callback cu err si produse 


    db.all('SELECT * FROM produse', (err, produse) => {
      if (err) 
        return res.status(500).send('Eroare pe server');
      
      //curat eventual mesajEroare din sesiune
      res.clearCookie('mesajEroare');     
      //incarc si transmit use produse si cos catre index sau array gol daca nu exsita
      //cosul de cumparaturi din sesiune: req/session.cos
      res.render('index', {
        user: utilizator,
        produse,
        cos: req.session.cos || []
      });
    });
  });


//adaugare-cos
app.get('/adaugare-cos', (req, res) => {
  //preluam id din query string de ex adresa /adaugare-cos?id=3 si l tansf in numar
  const idProdus = parseInt(req.query.id, 10);

  //daca idProdus nu e un numar, returnam eroare 400 Bad Request
  if (isNaN(idProdus)) 
    return res.status(400).send('ID invalid');

  //initializam cosul in sesiue daca inca nu exista
  //vom stoca in req.session.cos obiect de forma produsId: cantitate...
  if (!req.session.cos) req.session.cos = {};

  //crestem cant din cos pt produsul cu acel idprodus
  //daca nu exista in cos, il adaugam cu cantitatea 1
  //daca exista deja, incrementam cantitatea cu 1
  req.session.cos[idProdus] = (req.session.cos[idProdus] || 0) + 1;

  //afisare in consola 
  console.log('Coșul curent:', req.session.cos);
  //redirect la pagina principala 
  res.redirect('/');
});

//pagina cu continutul cosului de cumparaturi 
app.get('/vizualizare-cos', (req, res) => {
  //luam din sesiune obiectul cos, daca nu exista e gol
  const cos = req.session.cos || {};

  //extragem lista de id uri de produse din proprietatile obiectului cos
  //lista de chei : "3" : 2 -> "3" , "5" , si transf fiecare cheie in string
  const ids = Object.keys(cos).map(id => parseInt(id, 10));
  //le convertim din string in numere

  // daca nu sunt produse in cos, ids gol radam cu o listă goala si total 0
  if (ids.length === 0) {
    return res.render('vizualizare-cos', { items: [], total: 0 });
  }

  //??? pentru cate id uri am , pt query 
  const placeholders = ids.map(() => '?').join(',');
  // parcurgem si in locu valorii returnez ? 
  //join - lipeste elemente array ului separat prin virgula 

  //interogam bd cu parametrii ids
  db.all(`SELECT * FROM produse WHERE id IN (${placeholders})`, ids, (err, rows) => {
    if (err) 
      return res.status(500).send('Eroare pe server');
    //daca a aparut eroare la interogare, returnam eroare 500
    //rows este un array de obiecte cu produsele gasite in baza de date



    // construieşte lista cu cantităţi şi subtotaluri
    //mapam fiecare produs gasit in baza de date
    //pentru fiecare produs gasit in baza de date, construim un obiect cu id, nume, pret, cantitate si subtotal
    const items = rows.map(row => {
      //pentru fiecare produs gasit in baza de date, luam cantitatea din cos
      const qty = cos[row.id] || 0;
      //cos - tine cantitatile , row.id imi da cate articole sunt in cos pentru row.id
      const subtotal = (row.pret * qty).toFixed(2);
      //pret  unitar cu cantitatea qty si transf in string cu 2 zecimale 
      
      //forma cu 2 zecimale a pretului
      return {
        id:       row.id,
        nume:     row.nume,
        pret:     row.pret.toFixed(2),
        quantity: qty,
        subtotal
      };
    });

    const total = items
      .reduce((acc, it) => acc + parseFloat(it.subtotal), 0)
      .toFixed(2);
    //calculez totalul cosului, suma tuturor subtotalurilor
    //reduce ia un array si il transforma intr un singur numar, acc este acum suma tuturor subtotalurilor


    res.render('vizualizare-cos', { items, total });
  });
});

//accesare mesajEroare 
//pentru a afisa mesajul de eroare in pagina de autentificare
app.get('/autentificare', (req, res) => {

    const mesaj = req.session.mesajEroare;
    // cand autentificarea esueaza in post, pun un string acolo 
    //req.session.mesajEroare = null;

    //sau din cookie
    res.clearCookie('mesajEroare');
    //null , daca dau refresh sa nu vad din nou acelasi mesaj 
    //flash message intr un fel , il tin in sesiune doar pana la prima afisare
    res.render('autentificare', { mesaj });
    //render la autentificare , trimis mesaj acolo
    //res.render trimite catre client un raspuns html generat dintr un fisier de view
});


// middleware pentru a verifica daca utilizatorul este blocat
// daca a incercat prea multe autentificari eșuate
app.use('/verificare-autentificare', (req, res, next) => {
  const ip   = req.ip;
  const user = req.body.user;
  //ip si numele de utilizator din corpul cererii

  //verific daca e blocat 
  if (loginFailuresByIp[ip]?.blockedUntil > Date.now() || loginFailuresByUser[user]?.blockedUntil > Date.now()) 
  {
    //daca e blocat trimit http 403 - Forbidden
    //status si mesaj din template
    return res.status(403).render('error', {
    status: 403,
    message: '⛔ Ai fost blocat 20 de secunde pentru prea multe încercări de login.'
  });
  }

  //next() este o funcție care trece la următorul middleware sau ruta
  next();
});

//handler-ul de autentificare
app.post('/verificare-autentificare', async (req, res) => {
  const { user: username, pass: password } = req.body;
  //destructurare user si parola din corpul cererii
  //req.body este obiectul care conține datele trimise de client
  const ip = req.ip;
  //salvam ip-ul clientului care face cererea

  //citim lista de utilizatori din fisierul json 
  //loadUtilizatori este o funcție asincronă care returnează un array de utilizatori
  const utilizatori = await loadUtilizatori();
  const usr = utilizatori.find(u =>
    u.username === username && u.password === password
  ); //cautam potrivirea utilizatorului în lista de utilizatori
  //find returneaza primul element care se potriveste cu conditia


  if (usr) {
    // autentificare cu succes : reseteaza ambii contori
    delete loginFailuresByIp[ip];
    delete loginFailuresByUser[username];
    
    //scoatem parola din obiectul utilizatorului
    //pentru a nu o salva in sesiune
    //asa se scoate o proprietate dintr-un obiect
    const { parola, ...secure } = usr;
    //destructurare obiect , se pun toate celelalte intr un nou obiect, usr are parola 

    //salvam utilizatorul in sesiune, doar datele safe 
    req.session.user     = secure;
    req.session.userType = secure.role;

    if (req.body.remember) {
      res.cookie('rememberMe', username, {
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 zile
      });
  }
    //redirect la pagina principala
    return res.redirect('/');
  }

  // autentificare esuata : increment pentru IP si pentru user
  // trick js care itereaza de doua ori : odata cu store = loginFailuresByIp, key = ip
  //si odata cu store = loginFailuresByUser, key = username
  //daca nu s-a gasit utilizatorul, incrementam contorul de esecuri
  for (let [store, key] of 
    [[loginFailuresByIp, ip], [loginFailuresByUser, username]]) 
    {
      //daca nu exista in store, initializam cu 0 si 0
      //store este un obiect care contine esecurile de autentificare
      if (!store[key]) 
        store[key] = { count: 0, blockedUntil: 0 };
      
      //store[key] e un ob care e ori loginFailuresByIp, ori loginFailuresByUser
      
      store[key].count++;

      //daca am ajuns la 3 esecuri consecutive, blocam 5 secunde
      if (store[key].count >= 3) 
        {
          store[key].blockedUntil = Date.now() + 5*1000;  // 20 secunde
          store[key].count = 0;                    // resetam contorul pentru perioada de dupa deblocare
    }
  }

  //mesaj flash care va fi afisat la redirect catre /autentificare
  //req.session.mesajEroare este un mesaj de eroare care va fi afisat in pagina de autentificare
  req.session.mesajEroare = '❌ User sau parolă invalidă!!!';
 
  res.cookie('mesajEroare', '❌ User sau parolă invalidă!!!', {
    httpOnly: true,
    maxAge: 5*1000     // dispare singur după 5s
  });


  res.redirect('/autentificare');
  //redirect la pagina de autentificare
});


app.get('/deconectare', (req, res) => {
    req.session.destroy(err => {
    res.redirect('/');
  });
});

//PT ADMIN
//POST /admin pentru adăugarea unui produs
app.post('/admin', async (req, res) => {
  const { nume, pret, descriere } = req.body;
  //extragem cele 3 campuri din corpul cererii


  //validari - sanitizare date 
  if (nume.trim().length < 2 || nume.trim().length > 50) {
      return res.render('admin', { mesaj: '❌ Numele produsului e obligatoriu!' });
    }
    //nr in virgula mobila
    const pretNum = parseFloat(pret);
    //daca e valid, daca e abc ret nan
    if (Number.isNaN(pretNum) || pretNum < 0.01 || pretNum > 10000) {
      return res.render('admin', { mesaj: '❌ Preț invalid — trebuie să fie între 0 si 10000!' });
    }
    if (descriere.length > 200 || descriere.length < 5) {
      // descrierea trebuie să aiba intre 5 si 200 de caractere
      return res.render('admin', { mesaj: '❌ Descrierea trebuie să aibă între 5 și 200 de caractere!' });
    }


    //inserare in baza de date cu execute - functie care returnează un Promise
    //daca nu sunt erori, adaug produsul in baza de date
    try {
      // parametrizat ca sa previn SQL injection, await execute - apeleaza functia care ruleaza interogarea sql
      await execute(
        db,
        `INSERT INTO produse (nume, pret, descriere) VALUES (?, ?, ?)`,
        [nume.trim(), pretNum, descriere.trim()]
      );
      // afisez mesaj de succes
      return res.render('admin', { mesaj: '✅ Produs adăugat cu succes!' });
    } catch (err) {
      console.error('Eroare la adăugarea produsului:', err);
      return res.render('admin', { mesaj: '⛔ Eroare la adăugare!' });
    }
});


//middleware pentru a trata rutele care nu exista, intercepteaza orice cerere nepotrivita 
//rutele si middle in oridinea in care le am declarat 
//la inceput: capteaza toate cererile inainte sa ajunga la rutele specifice
app.use((req, res) => {
  if (req.path.startsWith('/.well-known/')) {
    //daca cererea este catre well-known, returnam 404
    //resursa nu a fost gasita
    return res.status(404).render('error', {
      status: 404,
      message: 'Resursa nu a fost găsită.'
    });
  }


  //console.log('404 pe:', req.path, '(înainte contor=', (blacklist[req.ip]?.count||0), ')');

  const ip = req.ip;
  //daca nu exista deja o intrare pentru acest ip in blacklist, initializam 
  if (!blacklist[ip]) {
    blacklist[ip] = { count: 0, blockedUntil: 0 };
  }

  const entry = blacklist[ip];
  //counter cereri inexistente 
  entry.count += 1;

  if (entry.count >= 3) {
    entry.blockedUntil = Date.now() + 10 * 1000;
    entry.count = 0;    //reset dupa deblocare
    return res.status(403).render('error', {
      status: 403,
      message: '⛔ Ai fost blocat pentru că ai încercat 3 resurse inexistente. Încearcă peste 10s.'
    });
  }

    res.status(404).render('error', {
    status: 404,
    message: `❓ Resursă inexistentă (${entry.count}/3).`
  });
});

// pornește serverul pe portul specificat
app.listen(port, () => {
  console.log(`Serverul rulează la adresa http://localhost:${port}/`);
});
