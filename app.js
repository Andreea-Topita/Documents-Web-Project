const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const cookieParser=require('cookie-parser');

const sqlite3         = require('sqlite3').verbose();      


//importam lista de intrebari din fisierul json
// fisierul json contine un array de obiecte cu intrebari, variante si raspuns corect
const fs = require('fs').promises;
const path = require('path');

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

app.use(cookieParser());   


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
  next();
});
//middleware pentru a face coșul de cumpărături disponibil în toate view-urile
// va fi disponibil in toate view-urile ca variabila "cos"
// daca nu exista cosul, il initializam ca obiect gol
app.use((req, res, next) => {
  res.locals.cos = req.session.cos || {};
  next();
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

  // redirect la pagină principală
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

    const mesajEroare = req.session.mesajEroare;
    req.session.mesajEroare = null;

    res.render('autentificare', { mesajEroare });
});

//verificare-autentificare post
app.post('/verificare-autentificare', async (req, res) => {
  const { user: username, pass: password } = req.body;
  const utilizatori = await loadUtilizatori();

  // caută utilizatorul în JSON
  const usr = utilizatori.find(u =>
    u.username === username && u.password === password
  );

  if (usr) {
    // 1. „Destructurăm” usr scoțând parola
    const { parola, ...secureProps } = usr;

    // 2. Salvăm în sesiune tot ce vrei fără parola
    req.session.user = secureProps;

    return res.redirect('/');
    } else {
        // autentificare FAIL → pune mesaj în sesiune și redirecționează
        req.session.mesajEroare = '❌ User sau parolă invalidă!!!';
        return res.redirect('/autentificare');
  }
});




app.get('/deconectare', (req, res) => {
    req.session.destroy(err => {
    res.redirect('/');
  });
});

// pornește serverul pe portul specificat
app.listen(port, () => {
  console.log(`Serverul rulează la adresa http://localhost:${port}/`);
});
