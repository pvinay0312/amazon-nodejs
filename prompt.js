import promptSync from "prompt-sync";
const prompt = promptSync();

var gender = prompt('are you a male or female? (M - male, F - Female): ');

if(gender == 'M' || gender == 'F') {
    console.log(gender);
} else {
    console.log('Try again.');
}
