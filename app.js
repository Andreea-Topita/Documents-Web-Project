const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const cookieParser=require('cookie-parser');

//importam lista de intrebari din fisierul json
// fisierul json contine un array de obiecte cu intrebari, variante si raspuns corect
const fs = require('fs').promises;
const path = require('path');

const session = require('express-session');


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



// la accesarea din browser adresei http://localhost:6789/chestionar se va apela funcția specificată
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
    //accesare cookie utilizator
  //daca utilizatorul este logat, cookie-ul va contine numele lui
    //daca nu este logat, cookie-ul va fi gol
  const utilizator = req.cookies.utilizator;   
  res.render('index', {

    utilizator
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
