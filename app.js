const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');


//importam lista de intrebari din fisierul json
// fisierul json contine un array de obiecte cu intrebari, variante si raspuns corect
const fs = require('fs').promises;
const path = require('path');



const app = express();
const port = 6789;

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



//functie asicrona de incarcare a fisierului json
async function loadIntrebari() {
    const filePath = path.join(__dirname, 'intrebari.json');
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
}


// la accesarea din browser adresei http://localhost:6789/ se va returna textul 'Hello World'
// proprietățile obiectului Request - req - https://expressjs.com/en/api.html#req
// proprietățile obiectului Response - res - https://expressjs.com/en/api.html#res
app.get('/', (req, res) => {
  res.send('Hello World');
});

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

// pornește serverul pe portul specificat
app.listen(port, () => {
  console.log(`Serverul rulează la adresa http://localhost:${port}/`);
});
