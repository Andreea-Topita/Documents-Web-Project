const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const cookieParser=require('cookie-parser');

const sqlite3 = require('sqlite3').verbose();      

//importam lista de intrebari din fisierul json
// fisierul json contine un array de obiecte cu intrebari, variante si raspuns corect
const fs = require('fs').promises;
const session = require('express-session');

//deschidem fisierul de baza de date SQLite
const dbFile = path.join(__dirname, 'cumparaturi.db');
const db     = new sqlite3.Database(dbFile, err => {
  if (err) console.error('Eroare la deschiderea BD:', err);
  else        console.log('BD SQLite deschisă:', dbFile);
});

const execute = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
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
  secret: 'secret-key', // cheia secreta pentru criptarea sesiunii
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // sesiune valabilă 1 zi
}));

 //disponibil in toate view-urile ca variabila "user"
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.userType = req.session.userType;
  next();
});



app.use((req, res, next) => {
  if (req.path.startsWith('/.well-known/')) {
      return res.status(404).render('error', {
        status: 404,
        message: 'Resursă nu a fost găsită (well-known).'
      });
    }

    const ip = req.ip;
    const entry = blacklist[ip];
    if (entry && entry.blockedUntil > Date.now()) {
      return res.status(403).render('error', {
        status: 403,
        message: '⛔ Sunteți blocat! Încercați din nou peste 10 secunde.'
      });
    }
    next();
});



//middleware pentru a face coșul de cumpărături disponibil în toate view-urile
// va fi disponibil in toate view-urile ca variabila "cos"
// daca nu exista cosul, il initializam ca obiect gol
app.use((req, res, next) => {
  res.locals.cos = req.session.cos || {};
  next();
});

//middleware pentru protectie a rutei /admin ,get 
//verifica orice cerere catre admin 
app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) {
    if (req.session.userType !== 'ADMIN') {
      return res.status(403).render('error', {
        status: 403,
        message: '⛔ Acces interzis: doar ADMIN.'
      });
    }
  }
  next();
});


//get, afisez formularul 
//mesaj e pentru post mai mult, cand chiar afizez mesajul de succes sau eroare
app.get('/admin', (req, res) => {
  res.render('admin', { mesaj: null });
});

async function loadUtilizatori() {
  const filePath = path.join(__dirname, 'utilizatori.json');
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

//functie asicrona de incarcare a fisierului json
async function loadIntrebari() {
    const filePath = path.join(__dirname, 'intrebari.json');
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
}

// la accesarea din browser adresei http://localhost:6789/ se va returna textul 'Hello World'
// proprietățile obiectului Request - req - https://expressjs.com/en/api.html#req
// proprietățile obiectului Response - res - https://expressjs.com/en/api.html#res

//LAB12 data base
app.get('/creare-bd', async (req, res) => {
  const sql = `
    CREATE TABLE IF NOT EXISTS produse (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nume TEXT NOT NULL,
      pret REAL NOT NULL,
      descriere TEXT
    );
  `;
  try {
    await execute(db, sql);
    console.log('Tabela produse creată (sau deja existentă)');
  } catch (err) {
    console.error('Eroare la creare tabelă:', err);
  }
  res.redirect('/');
});

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
        const intrebari = await loadIntrebari();
        //apelam functia de incarcare a fisierului json

        // în fișierul views/chestionar.ejs este accesibilă variabila 'intrebari'
        // care conține vectorul de întrebări
        res.render('chestionar', {
            titlu: 'Chestionar Documente',
            intrebari
        });
    } catch (err) {
        console.error('Eroare la citirea întrebărilor:', err);
        res.status(500).send('A apărut o eroare pe server.');
      }
});

app.post('/rezultat-chestionar', async (req, res) => {
    try {
        const intrebari = await loadIntrebari();

        const raspunsuri = req.body; //toate raspunsurile
        let cnt = 0; // contor
    
        //parcurg fiecare item si pozitia lui in listaIntrebari
        //verific daca raspunsul utilizatorului este corect
        intrebari.forEach(item  => {
            const ales = raspunsuri[item.intrebare];

            if (ales === item.variante[item.corect]) {
                cnt++;
            }
        });

        //trimitem catre pagina rezultat-chestionar.ejs nr de rasp corecte si total 
        res.render('rezultat-chestionar', {
        titlu: 'Rezultatul chestionarului',
        nrRaspCorecte: cnt,
        totalIntrebari: intrebari.length
        });
    } catch (err) {
        console.error('Eroare la procesarea rezultatelor:', err);
        res.status(500).send('A apărut o eroare pe server.');
    }
  });

//index.ejs
app.get('/', (req, res) => {
  const utilizator = req.session.user || null;
    db.all('SELECT * FROM produse', (err, produse) => {
      if (err) return res.status(500).send('Eroare pe server');
      res.render('index', {
        user: utilizator,
        produse,
        cos: req.session.cos || []
      });
    });
  });


//adaugare-cos
app.get('/adaugare-cos', (req, res) => {
  const idProdus = parseInt(req.query.id, 10);
  if (isNaN(idProdus)) return res.status(400).send('ID invalid');

  // initializează coșul ca obiect { idProdus: cantitate }
  if (!req.session.cos) req.session.cos = {};
  req.session.cos[idProdus] = (req.session.cos[idProdus] || 0) + 1;

  console.log('Coșul curent:', req.session.cos);
  res.redirect('/');
});

app.get('/vizualizare-cos', (req, res) => {
  const cos = req.session.cos || {};
  const ids = Object.keys(cos).map(id => parseInt(id, 10));
  if (ids.length === 0) {
    return res.render('vizualizare-cos', { items: [], total: 0 });
  }

  // scoate toate produsele din BD care sunt în coș
  const placeholders = ids.map(() => '?').join(',');
  db.all(`SELECT * FROM produse WHERE id IN (${placeholders})`, ids, (err, rows) => {
    if (err) return res.status(500).send('Eroare pe server');

    // construieşte lista cu cantităţi şi subtotaluri
    const items = rows.map(row => {
      const qty = cos[row.id] || 0;
      const subtotal = (row.pret * qty).toFixed(2);
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

    res.render('vizualizare-cos', { items, total });
  });
});

//autentificare.ejs
//accesare cookie mesajEroare
//daca cookie-ul este setat, se va afisa mesajul de eroare
app.get('/autentificare', (req, res) => {

    const mesaj = req.session.mesajEroare;
    // clear it so no refresh will ever see it again
    req.session.mesajEroare = null;
    // render with a single variable called "mesaj"
    res.render('autentificare', { mesaj });
});


app.use('/verificare-autentificare', (req, res, next) => {
  const ip   = req.ip;
  const user = req.body.user;

  if (loginFailuresByIp[ip]?.blockedUntil > Date.now() ||
    loginFailuresByUser[user]?.blockedUntil > Date.now()) {
  return res.status(403).render('error', {
    status: 403,
    message: '⛔ Ai fost blocat 20 de secunde pentru prea multe încercări de login.'
  });
  }

  next();
});

// apoi handler-ul tău de autentificare
app.post('/verificare-autentificare', async (req, res) => {
  const { user: username, pass: password } = req.body;
  const ip = req.ip;

  const utilizatori = await loadUtilizatori();
  const usr = utilizatori.find(u =>
    u.username === username && u.password === password
  );

  if (usr) {
    // autentificare cu succes → resetează ambii contori
    delete loginFailuresByIp[ip];
    delete loginFailuresByUser[username];

    const { parola, ...secure } = usr;
    req.session.user     = secure;
    req.session.userType = secure.role;
    return res.redirect('/');
  }

  // autentificare eșuată → increment pentru IP și pentru user
  for (let [store, key] of [[loginFailuresByIp, ip], [loginFailuresByUser, username]]) {
    if (!store[key]) store[key] = { count: 0, blockedUntil: 0 };
    store[key].count++;
    if (store[key].count >= 3) {
      store[key].blockedUntil = Date.now() + 5*1000;  // 20 secunde
      store[key].count        = 0;                    // reset pt. după deblocare
    }
  }

  req.session.mesajEroare = '❌ User sau parolă invalidă!!!';
  res.redirect('/autentificare');
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

  //validari - sanitizare date 
if (nume.trim().length < 2 || nume.trim().length > 50) {
    return res.render('admin', { mesaj: '❌ Numele produsului e obligatoriu!' });
  }
  const pretNum = parseFloat(pret);
  if (Number.isNaN(pretNum) || pretNum < 0.01 || pretNum > 10000) {
    return res.render('admin', { mesaj: '❌ Preț invalid — trebuie să fie între 0 si 10000!' });
  }
  if (descriere.length > 200 || descriere.length < 5) {
    // descrierea trebuie să aiba intre 5 si 200 de caractere
    return res.render('admin', { mesaj: '❌ Descrierea trebuie să aibă între 5 și 200 de caractere!' });
  }


  try {
    // parametrizat ca să previi SQL injection
    await execute(
      db,
      `INSERT INTO produse (nume, pret, descriere) VALUES (?, ?, ?)`,
      [nume.trim(), pretNum, descriere.trim()]
    );
    // afișezi mesaj de succes
    return res.render('admin', { mesaj: '✅ Produs adăugat cu succes!' });
  } catch (err) {
    console.error('Eroare la adăugarea produsului:', err);
    return res.render('admin', { mesaj: '⛔ Eroare la adăugare!' });
  }
});


app.use((req, res) => {
  if (req.path.startsWith('/.well-known/')) {
    return res.status(404).render('error', {
      status: 404,
      message: 'Resursă nu a fost găsită (well-known).'
    });
  }


  //console.log('404 pe:', req.path, '(înainte contor=', (blacklist[req.ip]?.count||0), ')');

  const ip = req.ip;
  if (!blacklist[ip]) {
    blacklist[ip] = { count: 0, blockedUntil: 0 };
  }
  const entry = blacklist[ip];

  entry.count += 1;

  if (entry.count >= 3) {
    // blocăm 30s
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
