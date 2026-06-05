import type { Language } from "../../../shared/src/index.js";

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
  ],
};

export function pickTrivia(language: Language, count: number): TriviaQuestion[] {
  const pool = TRIVIA[language] ?? TRIVIA.en;
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
}
