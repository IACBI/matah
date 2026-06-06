import type { Language } from "../../../shared/src/index.js";
import { sample } from "../util.js";

export interface TriviaQuestion {
  text: string;
  options: string[];
  correctIndex: number;
}

// Multiple-choice trivia per language. Keep correctIndex in sync with options.
const TRIVIA: Record<Language, TriviaQuestion[]> = {
  tr: [
    { text: "Dünya'nın en büyük okyanusu hangisidir?", options: ["Atlas", "Hint", "Pasifik", "Arktik"], correctIndex: 2 },
    { text: "Mona Lisa'yı kim çizdi?", options: ["Van Gogh", "Leonardo da Vinci", "Picasso", "Michelangelo"], correctIndex: 1 },
    { text: "Bir üçgenin iç açıları toplamı kaç derecedir?", options: ["90", "180", "270", "360"], correctIndex: 1 },
    { text: "Hangi gezegen 'Kızıl Gezegen' olarak bilinir?", options: ["Venüs", "Jüpiter", "Mars", "Satürn"], correctIndex: 2 },
    { text: "Türkiye'nin başkenti neresidir?", options: ["İstanbul", "İzmir", "Ankara", "Bursa"], correctIndex: 2 },
    { text: "Suyun kimyasal formülü nedir?", options: ["CO2", "H2O", "O2", "NaCl"], correctIndex: 1 },
    { text: "Hangi hayvan en hızlı kara hayvanıdır?", options: ["Aslan", "Çita", "At", "Ceylan"], correctIndex: 1 },
    { text: "İnsan vücudundaki en büyük organ hangisidir?", options: ["Kalp", "Karaciğer", "Deri", "Beyin"], correctIndex: 2 },
    { text: "Hangi yılda ay'a ilk insan ayak bastı?", options: ["1959", "1969", "1979", "1989"], correctIndex: 1 },
    { text: "Gökkuşağında kaç renk vardır?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "Dünya'da kaç kıta vardır?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "Japonya'nın başkenti neresidir?", options: ["Seul", "Pekin", "Tokyo", "Bangkok"], correctIndex: 2 },
    { text: "Bir örümceğin kaç bacağı vardır?", options: ["6", "8", "10", "12"], correctIndex: 1 },
    { text: "Doğadaki en sert madde hangisidir?", options: ["Altın", "Demir", "Elmas", "Kuvars"], correctIndex: 2 },
    { text: "Suyun donma noktası kaç °C'dir?", options: ["0", "32", "100", "-10"], correctIndex: 0 },
    { text: "Güneş'e en yakın gezegen hangisidir?", options: ["Venüs", "Merkür", "Dünya", "Mars"], correctIndex: 1 },
    { text: "Bitkiler hangi gazı emer?", options: ["Oksijen", "Karbondioksit", "Azot", "Hidrojen"], correctIndex: 1 },
    { text: "Bir altıgenin kaç kenarı vardır?", options: ["5", "6", "7", "8"], correctIndex: 1 },
    { text: "Mavi ile sarı karışınca hangi renk olur?", options: ["Yeşil", "Mor", "Turuncu", "Kahverengi"], correctIndex: 0 },
    { text: "Çin Seddi hangi ülkededir?", options: ["Hindistan", "Çin", "Japonya", "Kore"], correctIndex: 1 },
  ],
  en: [
    { text: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Pacific", "Arctic"], correctIndex: 2 },
    { text: "Who painted the Mona Lisa?", options: ["Van Gogh", "Leonardo da Vinci", "Picasso", "Michelangelo"], correctIndex: 1 },
    { text: "What do the interior angles of a triangle add up to?", options: ["90", "180", "270", "360"], correctIndex: 1 },
    { text: "Which planet is known as the 'Red Planet'?", options: ["Venus", "Jupiter", "Mars", "Saturn"], correctIndex: 2 },
    { text: "What is the capital of Australia?", options: ["Sydney", "Melbourne", "Canberra", "Perth"], correctIndex: 2 },
    { text: "What is the chemical formula for water?", options: ["CO2", "H2O", "O2", "NaCl"], correctIndex: 1 },
    { text: "Which is the fastest land animal?", options: ["Lion", "Cheetah", "Horse", "Gazelle"], correctIndex: 1 },
    { text: "What is the largest organ in the human body?", options: ["Heart", "Liver", "Skin", "Brain"], correctIndex: 2 },
    { text: "In what year did humans first land on the Moon?", options: ["1959", "1969", "1979", "1989"], correctIndex: 1 },
    { text: "How many colors are in a rainbow?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "How many continents are there?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "What is the capital of Japan?", options: ["Seoul", "Beijing", "Tokyo", "Bangkok"], correctIndex: 2 },
    { text: "How many legs does a spider have?", options: ["6", "8", "10", "12"], correctIndex: 1 },
    { text: "What is the hardest natural substance?", options: ["Gold", "Iron", "Diamond", "Quartz"], correctIndex: 2 },
    { text: "What is the freezing point of water in °C?", options: ["0", "32", "100", "-10"], correctIndex: 0 },
    { text: "Which planet is closest to the Sun?", options: ["Venus", "Mercury", "Earth", "Mars"], correctIndex: 1 },
    { text: "Which gas do plants absorb?", options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"], correctIndex: 1 },
    { text: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], correctIndex: 1 },
    { text: "Mixing blue and yellow makes which color?", options: ["Green", "Purple", "Orange", "Brown"], correctIndex: 0 },
    { text: "The Great Wall is in which country?", options: ["India", "China", "Japan", "Korea"], correctIndex: 1 },
  ],
  de: [
    { text: "Was ist der größte Ozean der Erde?", options: ["Atlantik", "Indik", "Pazifik", "Arktik"], correctIndex: 2 },
    { text: "Wer malte die Mona Lisa?", options: ["Van Gogh", "Leonardo da Vinci", "Picasso", "Michelangelo"], correctIndex: 1 },
    { text: "Wie viel ergeben die Innenwinkel eines Dreiecks?", options: ["90", "180", "270", "360"], correctIndex: 1 },
    { text: "Welcher Planet ist als 'Roter Planet' bekannt?", options: ["Venus", "Jupiter", "Mars", "Saturn"], correctIndex: 2 },
    { text: "Was ist die Hauptstadt von Australien?", options: ["Sydney", "Melbourne", "Canberra", "Perth"], correctIndex: 2 },
    { text: "Wie lautet die chemische Formel für Wasser?", options: ["CO2", "H2O", "O2", "NaCl"], correctIndex: 1 },
    { text: "Welches ist das schnellste Landtier?", options: ["Löwe", "Gepard", "Pferd", "Gazelle"], correctIndex: 1 },
    { text: "Was ist das größte Organ des menschlichen Körpers?", options: ["Herz", "Leber", "Haut", "Gehirn"], correctIndex: 2 },
    { text: "In welchem Jahr landeten Menschen erstmals auf dem Mond?", options: ["1959", "1969", "1979", "1989"], correctIndex: 1 },
    { text: "Wie viele Farben hat ein Regenbogen?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "Wie viele Kontinente gibt es?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "Was ist die Hauptstadt von Japan?", options: ["Seoul", "Peking", "Tokio", "Bangkok"], correctIndex: 2 },
    { text: "Wie viele Beine hat eine Spinne?", options: ["6", "8", "10", "12"], correctIndex: 1 },
    { text: "Was ist die härteste natürliche Substanz?", options: ["Gold", "Eisen", "Diamant", "Quarz"], correctIndex: 2 },
    { text: "Was ist der Gefrierpunkt von Wasser in °C?", options: ["0", "32", "100", "-10"], correctIndex: 0 },
    { text: "Welcher Planet ist der Sonne am nächsten?", options: ["Venus", "Merkur", "Erde", "Mars"], correctIndex: 1 },
    { text: "Welches Gas nehmen Pflanzen auf?", options: ["Sauerstoff", "Kohlendioxid", "Stickstoff", "Wasserstoff"], correctIndex: 1 },
    { text: "Wie viele Seiten hat ein Sechseck?", options: ["5", "6", "7", "8"], correctIndex: 1 },
    { text: "Blau und Gelb gemischt ergibt welche Farbe?", options: ["Grün", "Lila", "Orange", "Braun"], correctIndex: 0 },
    { text: "In welchem Land steht die Chinesische Mauer?", options: ["Indien", "China", "Japan", "Korea"], correctIndex: 1 },
  ],
  es: [
    { text: "¿Cuál es el océano más grande de la Tierra?", options: ["Atlántico", "Índico", "Pacífico", "Ártico"], correctIndex: 2 },
    { text: "¿Quién pintó la Mona Lisa?", options: ["Van Gogh", "Leonardo da Vinci", "Picasso", "Miguel Ángel"], correctIndex: 1 },
    { text: "¿Cuánto suman los ángulos internos de un triángulo?", options: ["90", "180", "270", "360"], correctIndex: 1 },
    { text: "¿Qué planeta es conocido como el 'Planeta Rojo'?", options: ["Venus", "Júpiter", "Marte", "Saturno"], correctIndex: 2 },
    { text: "¿Cuál es la capital de Australia?", options: ["Sídney", "Melbourne", "Canberra", "Perth"], correctIndex: 2 },
    { text: "¿Cuál es la fórmula química del agua?", options: ["CO2", "H2O", "O2", "NaCl"], correctIndex: 1 },
    { text: "¿Cuál es el animal terrestre más rápido?", options: ["León", "Guepardo", "Caballo", "Gacela"], correctIndex: 1 },
    { text: "¿Cuál es el órgano más grande del cuerpo humano?", options: ["Corazón", "Hígado", "Piel", "Cerebro"], correctIndex: 2 },
    { text: "¿En qué año el humano pisó la Luna por primera vez?", options: ["1959", "1969", "1979", "1989"], correctIndex: 1 },
    { text: "¿Cuántos colores tiene un arcoíris?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "¿Cuántos continentes hay?", options: ["5", "6", "7", "8"], correctIndex: 2 },
    { text: "¿Cuál es la capital de Japón?", options: ["Seúl", "Pekín", "Tokio", "Bangkok"], correctIndex: 2 },
    { text: "¿Cuántas patas tiene una araña?", options: ["6", "8", "10", "12"], correctIndex: 1 },
    { text: "¿Cuál es la sustancia natural más dura?", options: ["Oro", "Hierro", "Diamante", "Cuarzo"], correctIndex: 2 },
    { text: "¿Cuál es el punto de congelación del agua en °C?", options: ["0", "32", "100", "-10"], correctIndex: 0 },
    { text: "¿Qué planeta está más cerca del Sol?", options: ["Venus", "Mercurio", "Tierra", "Marte"], correctIndex: 1 },
    { text: "¿Qué gas absorben las plantas?", options: ["Oxígeno", "Dióxido de carbono", "Nitrógeno", "Hidrógeno"], correctIndex: 1 },
    { text: "¿Cuántos lados tiene un hexágono?", options: ["5", "6", "7", "8"], correctIndex: 1 },
    { text: "¿Mezclar azul y amarillo da qué color?", options: ["Verde", "Morado", "Naranja", "Marrón"], correctIndex: 0 },
    { text: "¿En qué país está la Gran Muralla?", options: ["India", "China", "Japón", "Corea"], correctIndex: 1 },
  ],
};

export function pickTrivia(language: Language, count: number): TriviaQuestion[] {
  return sample(TRIVIA[language] ?? TRIVIA.en, count);
}
